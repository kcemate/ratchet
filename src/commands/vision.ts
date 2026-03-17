/**
 * `ratchet vision` — interactive Cytoscape.js dependency graph overlaid with
 * Ratchet quality scores.
 */
import { Command } from 'commander';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';

import { printHeader, exitWithError, validateInt, withSpinner } from '../lib/cli.js';
import { buildVisionGraph, nodeColor } from '../core/vision.js';
import type { VisionGraph, VisionNode } from '../core/vision.js';

// ── HTML escaping ─────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── HTML template ─────────────────────────────────────────────────────────────

export function generateVisionHTML(graph: VisionGraph): string {
  // Serialise graph for embedding
  const cytoscapeElements = JSON.stringify({
    nodes: graph.nodes.map((n: VisionNode) => ({
      data: {
        id: n.id,
        label: n.label,
        score: n.score,
        issueCount: n.issueCount,
        issuesByCategory: n.issuesByCategory,
        blastRadius: n.blastRadius,
        directory: n.directory,
        color: nodeColor(n.score),
        size: Math.min(40, 12 + Math.sqrt(n.blastRadius) * 4),
      },
    })),
    edges: graph.edges.map(e => ({
      data: { id: `${e.source}->${e.target}`, source: e.source, target: e.target },
    })),
  });

  const meta = JSON.stringify({
    projectName: graph.projectName,
    totalScore: graph.totalScore,
    totalNodes: graph.totalNodes,
    shownNodes: graph.nodes.length,
    truncated: graph.truncated,
  });

  const categories = [
    'Testing', 'Security', 'Type Safety', 'Error Handling', 'Performance', 'Code Quality',
  ];
  const categoryOptions = categories
    .map(c => `<option value="${escHtml(c.toLowerCase())}">${escHtml(c)}</option>`)
    .join('\n        ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ratchet Vision — ${escHtml(graph.projectName)}</title>
  <script src="https://unpkg.com/cytoscape@3/dist/cytoscape.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0a;
      --bg2: #111111;
      --bg3: #1a1a1a;
      --border: #2a2a2a;
      --gold: #f5a623;
      --gold-dim: #b37a1a;
      --text: #e5e5e5;
      --text-dim: #888888;
      --red: #ef4444;
      --yellow: #f59e0b;
      --green: #22c55e;
      --sidebar-w: 300px;
    }

    html, body { height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; }

    #app { display: flex; height: 100vh; overflow: hidden; }

    /* ── Sidebar ── */
    #sidebar {
      width: var(--sidebar-w);
      min-width: var(--sidebar-w);
      background: var(--bg2);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    #sidebar-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg3);
    }

    #sidebar-header h1 {
      font-size: 15px;
      font-weight: 700;
      color: var(--gold);
      letter-spacing: 0.5px;
    }

    #sidebar-header .meta {
      margin-top: 6px;
      font-size: 12px;
      color: var(--text-dim);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    #sidebar-header .score-badge {
      color: var(--text);
      font-weight: 600;
    }

    #sidebar-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .section-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--text-dim);
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    /* Search */
    #search {
      width: 100%;
      padding: 7px 10px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      outline: none;
    }
    #search:focus { border-color: var(--gold-dim); }
    #search::placeholder { color: var(--text-dim); }

    /* Filter selects */
    select {
      width: 100%;
      padding: 7px 10px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 13px;
      outline: none;
      cursor: pointer;
    }
    select:focus { border-color: var(--gold-dim); }

    /* Score range */
    .score-radios { display: flex; flex-direction: column; gap: 5px; }
    .score-radios label {
      display: flex; align-items: center; gap: 7px; cursor: pointer; font-size: 12px;
    }
    .score-radios input[type=radio] { accent-color: var(--gold); }

    /* Legend */
    .legend { display: flex; flex-direction: column; gap: 6px; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .legend-dot {
      width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
    }
    .legend-size-note {
      font-size: 11px; color: var(--text-dim); margin-top: 4px; line-height: 1.5;
    }

    /* Detail panel */
    #detail {
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
      line-height: 1.7;
      display: none;
    }
    #detail.visible { display: block; }
    #detail h2 { font-size: 13px; font-weight: 700; color: var(--gold); margin-bottom: 8px; word-break: break-all; }
    #detail .detail-row { display: flex; justify-content: space-between; gap: 8px; }
    #detail .detail-label { color: var(--text-dim); }
    #detail .detail-val { font-weight: 600; }
    #detail .detail-issues { margin-top: 8px; }
    #detail .detail-issues-title { color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
    #detail .issue-cat { display: flex; justify-content: space-between; }
    #detail .issue-cat-name { color: var(--text-dim); }
    #detail .issue-cat-count { font-weight: 600; color: var(--yellow); }

    /* Node count */
    #node-count { font-size: 11px; color: var(--text-dim); margin-top: -4px; }

    /* Truncation warning */
    #trunc-warn {
      background: #2a1a00;
      border: 1px solid var(--gold-dim);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 11px;
      color: var(--gold);
      display: none;
    }
    #trunc-warn.visible { display: block; }

    /* ── Graph canvas ── */
    #cy { flex: 1; background: var(--bg); }

    /* ── Tooltip ── */
    #tooltip {
      position: fixed;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      pointer-events: none;
      z-index: 1000;
      display: none;
      max-width: 260px;
      line-height: 1.6;
      box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    }
    #tooltip .tt-name { font-weight: 700; color: var(--gold); margin-bottom: 4px; word-break: break-all; }
    #tooltip .tt-row { display: flex; gap: 6px; }
    #tooltip .tt-label { color: var(--text-dim); }

    /* Scrollbar */
    #sidebar-scroll::-webkit-scrollbar { width: 4px; }
    #sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
    #sidebar-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    /* ARIA focus outline */
    :focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
  </style>
</head>
<body>
<div id="app" role="main">

  <!-- Sidebar -->
  <aside id="sidebar" aria-label="Graph controls and file details">
    <div id="sidebar-header">
      <h1>⚡ Ratchet Vision</h1>
      <div class="meta">
        <span id="project-name"></span>
        <span>Score: <span id="total-score" class="score-badge"></span>/100</span>
      </div>
    </div>

    <div id="sidebar-scroll">

      <div id="trunc-warn" role="alert" aria-live="polite">
        ⚠ Graph truncated to <span id="max-nodes-shown"></span> nodes. Use --focus or --filter to narrow the view.
      </div>

      <!-- Search -->
      <div>
        <div class="section-label">Search</div>
        <input
          id="search"
          type="search"
          placeholder="Filter by filename…"
          aria-label="Search files by name"
          autocomplete="off"
        />
        <div id="node-count" aria-live="polite"></div>
      </div>

      <!-- Category filter -->
      <div>
        <div class="section-label">Issue Category</div>
        <select id="cat-filter" aria-label="Filter by issue category">
          <option value="">All categories</option>
        ${categoryOptions}
        </select>
      </div>

      <!-- Score range -->
      <div>
        <div class="section-label">Score Range</div>
        <div class="score-radios" role="radiogroup" aria-label="Filter by score range">
          <label><input type="radio" name="score-range" value="all" checked> All scores</label>
          <label><input type="radio" name="score-range" value="green"> <span style="color:#22c55e">●</span> Good (>80)</label>
          <label><input type="radio" name="score-range" value="yellow"> <span style="color:#f59e0b">●</span> Fair (50–80)</label>
          <label><input type="radio" name="score-range" value="red"> <span style="color:#ef4444">●</span> Poor (&lt;50)</label>
        </div>
      </div>

      <!-- Legend -->
      <div>
        <div class="section-label">Legend</div>
        <div class="legend" role="img" aria-label="Color and size legend">
          <div class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>Score &gt; 80 — Good</div>
          <div class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span>Score 50–80 — Fair</div>
          <div class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>Score &lt; 50 — Poor</div>
          <p class="legend-size-note">Node size = blast radius (how many files import this one).</p>
        </div>
      </div>

      <!-- Detail panel -->
      <div id="detail" aria-live="polite" aria-label="Selected file details">
        <h2 id="detail-name"></h2>
        <div class="detail-row">
          <span class="detail-label">Score</span>
          <span class="detail-val" id="detail-score"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Issues</span>
          <span class="detail-val" id="detail-issues-count"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Blast radius</span>
          <span class="detail-val" id="detail-blast"></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Directory</span>
          <span class="detail-val" id="detail-dir"></span>
        </div>
        <div id="detail-cat-breakdown" class="detail-issues"></div>
      </div>

    </div><!-- /sidebar-scroll -->
  </aside>

  <!-- Graph canvas -->
  <div id="cy" role="img" aria-label="Dependency graph"></div>

  <!-- Hover tooltip -->
  <div id="tooltip" role="tooltip" aria-hidden="true"></div>

</div><!-- /app -->

<script>
(function () {
  'use strict';

  const ELEMENTS = ${cytoscapeElements};
  const META     = ${meta};

  // ── Populate header ───────────────────────────────────────────────────────
  document.getElementById('project-name').textContent = META.projectName;
  const scoreEl = document.getElementById('total-score');
  scoreEl.textContent = META.totalScore;
  scoreEl.style.color = META.totalScore > 80 ? '#22c55e' : META.totalScore >= 50 ? '#f59e0b' : '#ef4444';

  if (META.truncated) {
    document.getElementById('trunc-warn').classList.add('visible');
    document.getElementById('max-nodes-shown').textContent = META.shownNodes;
  }

  // ── Cytoscape init ────────────────────────────────────────────────────────
  const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: ELEMENTS,
    layout: {
      name: 'cose',
      animate: false,
      nodeRepulsion: function() { return 8000; },
      idealEdgeLength: function() { return 100; },
      edgeElasticity: function() { return 100; },
      nestingFactor: 5,
      gravity: 80,
      numIter: 1000,
      coolingFactor: 0.99,
      minTemp: 1.0,
    },
    style: [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          'label': 'data(label)',
          'width': 'data(size)',
          'height': 'data(size)',
          'font-size': 9,
          'color': '#cccccc',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 4,
          'text-outline-color': '#0a0a0a',
          'text-outline-width': 2,
          'border-width': 1.5,
          'border-color': '#333333',
          'min-zoomed-font-size': 8,
        },
      },
      {
        selector: 'node.highlighted',
        style: {
          'border-color': '#f5a623',
          'border-width': 3,
          'z-index': 10,
        },
      },
      {
        selector: 'node.faded',
        style: {
          'opacity': 0.2,
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1,
          'line-color': '#2a2a2a',
          'target-arrow-color': '#3a3a3a',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 0.8,
          'opacity': 0.7,
        },
      },
      {
        selector: 'edge.highlighted',
        style: {
          'line-color': '#f5a623',
          'target-arrow-color': '#f5a623',
          'opacity': 1,
          'z-index': 9,
        },
      },
      {
        selector: 'edge.faded',
        style: { 'opacity': 0.05 },
      },
    ],
    wheelSensitivity: 0.3,
  });

  updateNodeCount();

  // ── Tooltip ───────────────────────────────────────────────────────────────
  const tooltip = document.getElementById('tooltip');

  cy.on('mouseover', 'node', function (e) {
    const d = e.target.data();
    tooltip.innerHTML =
      '<div class="tt-name">' + escHtml(d.label) + '</div>' +
      '<div class="tt-row"><span class="tt-label">Score</span> ' + d.score + '/100</div>' +
      '<div class="tt-row"><span class="tt-label">Issues</span> ' + d.issueCount + '</div>' +
      '<div class="tt-row"><span class="tt-label">Blast radius</span> ' + d.blastRadius + '</div>' +
      '<div class="tt-row"><span class="tt-label">Dir</span> ' + escHtml(d.directory || '.') + '</div>';
    tooltip.style.display = 'block';
    tooltip.removeAttribute('aria-hidden');
  });

  cy.on('mouseout', 'node', function () {
    tooltip.style.display = 'none';
    tooltip.setAttribute('aria-hidden', 'true');
  });

  cy.on('mousemove', function (e) {
    if (tooltip.style.display === 'none') return;
    tooltip.style.left = (e.originalEvent.clientX + 14) + 'px';
    tooltip.style.top  = (e.originalEvent.clientY + 14) + 'px';
  });

  // ── Node click — detail panel ─────────────────────────────────────────────
  const detail      = document.getElementById('detail');
  const detailName  = document.getElementById('detail-name');
  const detailScore = document.getElementById('detail-score');
  const detailIssues = document.getElementById('detail-issues-count');
  const detailBlast = document.getElementById('detail-blast');
  const detailDir   = document.getElementById('detail-dir');
  const detailCats  = document.getElementById('detail-cat-breakdown');

  cy.on('tap', 'node', function (e) {
    const d = e.target.data();

    // Highlight neighbourhood
    cy.elements().removeClass('highlighted faded');
    const neighborhood = e.target.closedNeighborhood();
    cy.elements().not(neighborhood).addClass('faded');
    neighborhood.addClass('highlighted');

    // Populate detail panel
    detailName.textContent = d.label;
    detailScore.textContent = d.score + '/100';
    detailScore.style.color = d.score > 80 ? '#22c55e' : d.score >= 50 ? '#f59e0b' : '#ef4444';
    detailIssues.textContent = d.issueCount;
    detailBlast.textContent = d.blastRadius + ' dependents';
    detailDir.textContent = d.directory || '.';

    const cats = d.issuesByCategory || {};
    const catKeys = Object.keys(cats);
    if (catKeys.length > 0) {
      const rows = catKeys
        .sort((a, b) => cats[b] - cats[a])
        .map(k =>
          '<div class="issue-cat">' +
          '<span class="issue-cat-name">' + escHtml(k) + '</span>' +
          '<span class="issue-cat-count">' + cats[k] + '</span>' +
          '</div>',
        ).join('');
      detailCats.innerHTML = '<div class="detail-issues-title">Issues by category</div>' + rows;
    } else {
      detailCats.innerHTML = '';
    }

    detail.classList.add('visible');
  });

  cy.on('tap', function (e) {
    if (e.target === cy) {
      cy.elements().removeClass('highlighted faded');
      detail.classList.remove('visible');
    }
  });

  // ── Keyboard navigation ───────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      cy.elements().removeClass('highlighted faded');
      detail.classList.remove('visible');
    }
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
      document.getElementById('search').focus();
      e.preventDefault();
    }
  });

  // ── Search ────────────────────────────────────────────────────────────────
  const searchInput = document.getElementById('search');
  searchInput.addEventListener('input', applyFilters);

  // ── Category filter ───────────────────────────────────────────────────────
  document.getElementById('cat-filter').addEventListener('change', applyFilters);

  // ── Score range ───────────────────────────────────────────────────────────
  document.querySelectorAll('input[name="score-range"]').forEach(function (radio) {
    radio.addEventListener('change', applyFilters);
  });

  function applyFilters() {
    const q    = searchInput.value.toLowerCase().trim();
    const cat  = document.getElementById('cat-filter').value;
    const range = document.querySelector('input[name="score-range"]:checked').value;

    cy.nodes().forEach(function (node) {
      const d = node.data();
      const nameMatch = !q || d.label.toLowerCase().includes(q);
      const catMatch  = !cat || (d.issuesByCategory && d.issuesByCategory[cat] > 0 ||
        cat === '' || Object.keys(d.issuesByCategory || {}).some(k => k.toLowerCase().includes(cat)));
      const rangeMatch = range === 'all' ||
        (range === 'green'  && d.score > 80) ||
        (range === 'yellow' && d.score >= 50 && d.score <= 80) ||
        (range === 'red'    && d.score < 50);

      if (nameMatch && catMatch && rangeMatch) {
        node.style('display', 'element');
      } else {
        node.style('display', 'none');
      }
    });

    // Hide edges whose nodes are hidden
    cy.edges().forEach(function (edge) {
      const srcVisible = edge.source().style('display') !== 'none';
      const tgtVisible = edge.target().style('display') !== 'none';
      edge.style('display', srcVisible && tgtVisible ? 'element' : 'none');
    });

    updateNodeCount();
  }

  function updateNodeCount() {
    const visible = cy.nodes().filter(n => n.style('display') !== 'none').length;
    document.getElementById('node-count').textContent =
      visible + ' of ' + cy.nodes().length + ' files shown';
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
</script>
</body>
</html>`;
}

// ── PNG export (puppeteer) ────────────────────────────────────────────────────

async function exportPng(htmlContent: string, outputPath: string): Promise<void> {
  const { default: puppeteer } = await import('puppeteer');

  const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-vision-'));
  const tmpHtml = join(tmpDir, 'vision.html');

  try {
    await writeFile(tmpHtml, htmlContent, 'utf-8');

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Wait for Cytoscape to finish layout
    await page.waitForFunction(() => {
      const win = window as Window & { cytoscape?: unknown };
      return typeof win.cytoscape !== 'undefined';
    }, { timeout: 10_000 }).catch(() => {/* proceed anyway */});

    await new Promise(res => setTimeout(res, 2000));

    await page.screenshot({ path: outputPath as `${string}.png`, fullPage: false });
    await browser.close();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ── PDF export ────────────────────────────────────────────────────────────────

async function exportPdf(htmlContent: string, outputPath: string): Promise<void> {
  const { default: puppeteer } = await import('puppeteer');

  const tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-vision-'));
  const tmpHtml = join(tmpDir, 'vision.html');

  try {
    await writeFile(tmpHtml, htmlContent, 'utf-8');

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise(res => setTimeout(res, 2000));

    await page.pdf({
      path: outputPath,
      width: '1400px',
      height: '900px',
      printBackground: true,
    });

    await browser.close();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ── Command ───────────────────────────────────────────────────────────────────

export function visionCommand(): Command {
  const cmd = new Command('vision');

  cmd
    .description(
      'Generate an interactive dependency graph overlaid with Ratchet quality scores.\n\n' +
      'Nodes are colour-coded by score (green > 80, yellow 50–80, red < 50).\n' +
      'Node size reflects blast radius (number of dependents).\n' +
      'Output is a self-contained HTML file viewable in any browser.',
    )
    .option('--static',              'Export as PNG instead of interactive HTML')
    .option('--export-pdf',          'Embed graph snapshot into a PDF')
    .option('--focus <path>',        'Zoom to N-hop neighbourhood of a specific file')
    .option('--filter <type>',       'Filter nodes by issue category (e.g. security, testing)')
    .option('--output <path>',       'Output file path (default: ratchet-vision.html / .png / .pdf)')
    .option('--max-nodes <n>',       'Maximum nodes to render (default: 500)', '500')
    .option('--focus-hops <n>',      'Neighbourhood depth for --focus mode (default: 2)', '2')
    .addHelpText(
      'after',
      '\nExamples:\n' +
      '  $ ratchet vision\n' +
      '  $ ratchet vision --focus src/core/engine.ts\n' +
      '  $ ratchet vision --filter security --output security-graph.html\n' +
      '  $ ratchet vision --static --output graph.png\n' +
      '  $ ratchet vision --export-pdf --output report.pdf\n',
    )
    .action(async (options: {
      static?: boolean;
      exportPdf?: boolean;
      focus?: string;
      filter?: string;
      output?: string;
      maxNodes: string;
      focusHops: string;
    }) => {
      const cwd = process.cwd();

      printHeader('🔭 Ratchet Vision');

      const maxNodes = validateInt(options.maxNodes, 'max-nodes', 1);
      const focusHops = validateInt(options.focusHops, 'focus-hops', 1, 5);

      const isStatic   = options.static === true;
      const isPdf      = options.exportPdf === true;
      const defaultExt = isStatic ? 'png' : isPdf ? 'pdf' : 'html';
      const outputPath = resolve(options.output ?? join(cwd, `ratchet-vision.${defaultExt}`));

      process.stdout.write(
        `  Project  : ${chalk.cyan(cwd)}\n` +
        (options.focus  ? `  Focus    : ${chalk.yellow(options.focus)}\n`  : '') +
        (options.filter ? `  Filter   : ${chalk.yellow(options.filter)}\n` : '') +
        `  Output   : ${chalk.dim(outputPath)}\n\n`,
      );

      // Build graph
      let graph: VisionGraph;
      await withSpinner('Building dependency graph…', async spinner => {
        graph = await buildVisionGraph({
          cwd,
          focus: options.focus,
          filter: options.filter,
          maxNodes,
          focusHops,
        });

        if (graph.truncated) {
          spinner.warn(
            chalk.yellow(
              `  Graph truncated: showing ${graph.nodes.length} of ${graph.totalNodes} files. ` +
              'Use --focus or --filter to narrow the view.',
            ),
          );
        } else {
          spinner.succeed(
            `  Graph built: ${chalk.bold(String(graph.nodes.length))} nodes, ` +
            `${chalk.bold(String(graph.edges.length))} edges`,
          );
        }
      }, 'Graph build failed');

      const html = generateVisionHTML(graph!);

      if (isStatic) {
        await withSpinner('Rendering PNG via Puppeteer…', async spinner => {
          await exportPng(html, outputPath);
          spinner.succeed(`  PNG saved: ${chalk.dim(outputPath)}`);
        }, 'PNG export failed');
      } else if (isPdf) {
        await withSpinner('Rendering PDF via Puppeteer…', async spinner => {
          await exportPdf(html, outputPath);
          spinner.succeed(`  PDF saved: ${chalk.dim(outputPath)}`);
        }, 'PDF export failed');
      } else {
        await writeFile(outputPath, html, 'utf-8');
        process.stdout.write(`  HTML saved: ${chalk.dim(outputPath)}\n`);
        process.stdout.write(
          chalk.dim(`\n  Open in your browser:\n    open ${outputPath}\n\n`),
        );
      }

      // Print summary
      process.stdout.write(
        `  Score    : ${chalk.bold(String(graph!.totalScore))}/100\n` +
        `  Nodes    : ${graph!.nodes.length} files\n` +
        `  Edges    : ${graph!.edges.length} dependencies\n\n`,
      );

      if (graph!.truncated) {
        process.stdout.write(
          chalk.yellow(
            `  ⚠  ${graph!.totalNodes - graph!.nodes.length} files were excluded due to --max-nodes=${maxNodes}\n\n`,
          ),
        );
      }
    });

  return cmd;
}
