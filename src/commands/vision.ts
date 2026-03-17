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
import { buildVisionGraph, nodeColor, glowColor } from '../core/vision.js';
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
    nodes: graph.nodes.map((n: VisionNode) => {
      const color = nodeColor(n.score);
      const glow = glowColor(n.score);
      // Convert hex color to rgba for border (0.6 opacity)
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      const borderColor = `rgba(${r},${g},${b},0.6)`;
      return {
        data: {
          id: n.id,
          label: n.label,
          score: n.score,
          issueCount: n.issueCount,
          issuesByCategory: n.issuesByCategory,
          blastRadius: n.blastRadius,
          directory: n.directory,
          color,
          glow,
          borderColor,
          size: Math.min(40, 12 + Math.sqrt(n.blastRadius) * 4),
        },
      };
    }),
    edges: graph.edges.map(e => {
      const sourceNode = graph.nodes.find(n => n.id === e.source);
      return {
        data: {
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          sourceScore: sourceNode?.score ?? 100,
        },
      };
    }),
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
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/cytoscape@3/dist/cytoscape.min.js"></script>
  <script src="https://unpkg.com/cytoscape-fcose@2/cytoscape-fcose.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-primary: #0a0e17;
      --bg-secondary: #0f1419;
      --bg-elevated: #151c28;
      --border: #1e293b;
      --accent-primary: #6366f1;
      --accent-secondary: #8b5cf6;
      --edge-default: rgba(148,163,184,0.08);
      --edge-highlight: rgba(34,211,238,0.8);
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #475569;
      --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      --sidebar-w: 300px;
    }

    html, body {
      height: 100%;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13px;
    }

    #app { display: flex; height: 100vh; overflow: hidden; }

    /* ── Sidebar ── */
    #sidebar {
      width: var(--sidebar-w);
      min-width: var(--sidebar-w);
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 10;
    }

    #sidebar-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-elevated);
    }

    #sidebar-header h1 {
      font-size: 15px;
      font-weight: 700;
      color: var(--accent-primary);
      letter-spacing: 0.5px;
      font-family: var(--font-sans);
      margin-bottom: 10px;
    }

    #score-ring-wrapper {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 4px;
    }

    #score-ring-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    #project-name {
      font-size: 12px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-weight: 500;
    }

    .score-ring-label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
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
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    /* Search */
    #search {
      width: 100%;
      padding: 7px 10px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 13px;
      font-family: var(--font-sans);
      outline: none;
      transition: border-color 0.2s;
    }
    #search:focus { border-color: var(--accent-primary); }
    #search::placeholder { color: var(--text-muted); }

    /* Filter selects */
    select {
      width: 100%;
      padding: 7px 10px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 13px;
      font-family: var(--font-sans);
      outline: none;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    select:focus { border-color: var(--accent-primary); }

    /* Score range */
    .score-radios { display: flex; flex-direction: column; gap: 5px; }
    .score-radios label {
      display: flex; align-items: center; gap: 7px; cursor: pointer; font-size: 12px;
    }
    .score-radios input[type=radio] { accent-color: var(--accent-primary); }

    /* Legend */
    .legend { display: flex; flex-direction: column; gap: 6px; }
    .legend-item {
      display: flex; align-items: center; gap: 8px; font-size: 12px;
      cursor: pointer; padding: 4px 6px; border-radius: 4px;
      transition: background 0.15s;
      border: 1px solid transparent;
    }
    .legend-item:hover { background: var(--bg-elevated); border-color: var(--border); }
    .legend-item.active { background: var(--bg-elevated); border-color: var(--accent-primary); }
    .legend-dot {
      width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
      box-shadow: 0 0 6px currentColor;
    }
    .legend-size-note {
      font-size: 11px; color: var(--text-muted); margin-top: 4px; line-height: 1.5;
    }

    /* Detail panel */
    #detail {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
      line-height: 1.7;
      display: none;
    }
    #detail.visible { display: block; }
    #detail h2 {
      font-size: 12px; font-weight: 700; color: var(--accent-primary);
      margin-bottom: 8px; word-break: break-all;
      font-family: var(--font-mono);
    }
    #detail .detail-row { display: flex; justify-content: space-between; gap: 8px; }
    #detail .detail-label { color: var(--text-muted); }
    #detail .detail-val { font-weight: 600; color: var(--text-primary); }
    #detail .detail-issues { margin-top: 8px; }
    #detail .detail-issues-title {
      color: var(--text-muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px;
    }
    #detail .issue-cat { display: flex; justify-content: space-between; }
    #detail .issue-cat-name { color: var(--text-secondary); }
    #detail .issue-cat-count { font-weight: 600; color: #fbbf24; }

    /* Node count */
    #node-count { font-size: 11px; color: var(--text-muted); margin-top: -4px; }

    /* Truncation warning */
    #trunc-warn {
      background: rgba(99,102,241,0.1);
      border: 1px solid rgba(99,102,241,0.4);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 11px;
      color: var(--accent-primary);
      display: none;
    }
    #trunc-warn.visible { display: block; }

    /* ── Graph area ── */
    #cy-wrapper {
      position: relative;
      flex: 1;
      overflow: hidden;
      background:
        radial-gradient(ellipse at 50% 40%, rgba(99,102,241,0.08) 0%, transparent 60%),
        repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(34,211,238,0.03) 39px, rgba(34,211,238,0.03) 40px),
        repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(34,211,238,0.03) 39px, rgba(34,211,238,0.03) 40px),
        #0a0e17;
    }

    #cy-wrapper::after {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at center, transparent 40%, rgba(10,14,23,0.7) 100%);
      pointer-events: none;
      z-index: 2;
    }

    #particles {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
    }

    #cy {
      position: absolute;
      inset: 0;
      z-index: 1;
      background: transparent !important;
    }

    /* ── Tooltip ── */
    #tooltip {
      position: fixed;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      pointer-events: none;
      z-index: 1000;
      display: none;
      max-width: 260px;
      line-height: 1.6;
      box-shadow: 0 4px 24px rgba(0,0,0,0.8);
    }
    #tooltip .tt-name {
      font-weight: 700; color: var(--accent-primary); margin-bottom: 4px;
      word-break: break-all; font-family: var(--font-mono); font-size: 11px;
    }
    #tooltip .tt-row { display: flex; gap: 6px; }
    #tooltip .tt-label { color: var(--text-muted); }

    /* Scrollbar */
    #sidebar-scroll::-webkit-scrollbar { width: 4px; }
    #sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
    #sidebar-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    /* ARIA focus outline */
    :focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
  </style>
</head>
<body>

<!-- SVG Glow Filter -->
<svg style="position:absolute;width:0;height:0">
  <defs>
    <filter id="glow-filter" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
</svg>

<div id="app" role="main">

  <!-- Sidebar -->
  <aside id="sidebar" aria-label="Graph controls and file details">
    <div id="sidebar-header">
      <h1>⚡ Ratchet Vision</h1>
      <div id="score-ring-wrapper">
        <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r="22" fill="none" stroke="#1e293b" stroke-width="4"/>
          <circle id="score-ring-arc" cx="30" cy="30" r="22" fill="none"
            stroke="#6366f1" stroke-width="4"
            stroke-dasharray="138.23" stroke-dashoffset="138.23"
            stroke-linecap="round"
            transform="rotate(-90 30 30)"
            style="transition: stroke-dashoffset 1s ease, stroke 0.5s ease"/>
          <text id="score-ring-text" x="30" y="34" text-anchor="middle"
            fill="#f1f5f9" font-size="13" font-weight="600"
            font-family="Inter, sans-serif"></text>
        </svg>
        <div id="score-ring-info">
          <div class="score-ring-label">Project Score</div>
          <div id="project-name"></div>
        </div>
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
          <label><input type="radio" name="score-range" value="good"> <span style="color:#22d3ee">●</span> Good (≥80)</label>
          <label><input type="radio" name="score-range" value="caution"> <span style="color:#fbbf24">●</span> Caution (40–79)</label>
          <label><input type="radio" name="score-range" value="danger"> <span style="color:#ef4444">●</span> Danger (&lt;40)</label>
        </div>
      </div>

      <!-- Legend (clickable) -->
      <div>
        <div class="section-label">Legend — click to isolate</div>
        <div class="legend" role="list" aria-label="Color and size legend">
          <div class="legend-item" role="listitem" data-tier="excellent" tabindex="0" aria-label="Excellent tier: score above 90">
            <span class="legend-dot" style="background:#00ff88;color:#00ff88"></span>Score &gt; 90 — Excellent
          </div>
          <div class="legend-item" role="listitem" data-tier="good" tabindex="0" aria-label="Good tier: score 80 to 90">
            <span class="legend-dot" style="background:#22d3ee;color:#22d3ee"></span>Score 80–90 — Good
          </div>
          <div class="legend-item" role="listitem" data-tier="warning" tabindex="0" aria-label="Warning tier: score 60 to 80">
            <span class="legend-dot" style="background:#fbbf24;color:#fbbf24"></span>Score 60–80 — Warning
          </div>
          <div class="legend-item" role="listitem" data-tier="caution" tabindex="0" aria-label="Caution tier: score 40 to 60">
            <span class="legend-dot" style="background:#f97316;color:#f97316"></span>Score 40–60 — Caution
          </div>
          <div class="legend-item" role="listitem" data-tier="danger" tabindex="0" aria-label="Danger tier: score 20 to 40">
            <span class="legend-dot" style="background:#ef4444;color:#ef4444"></span>Score 20–40 — Danger
          </div>
          <div class="legend-item" role="listitem" data-tier="critical" tabindex="0" aria-label="Critical tier: score below 20">
            <span class="legend-dot" style="background:#ff2d55;color:#ff2d55"></span>Score &lt; 20 — Critical
          </div>
          <p class="legend-size-note">Node size = blast radius (dependents). Click a tier to isolate.</p>
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

  <!-- Graph area -->
  <div id="cy-wrapper">
    <canvas id="particles" aria-hidden="true"></canvas>
    <div id="cy" role="img" aria-label="Dependency graph"></div>
  </div>

</div><!-- /app -->

<!-- Hover tooltip -->
<div id="tooltip" role="tooltip" aria-hidden="true"></div>

<script>
(function () {
  'use strict';

  const ELEMENTS = ${cytoscapeElements};
  const META     = ${meta};

  // ── Score ring ────────────────────────────────────────────────────────────
  document.getElementById('project-name').textContent = META.projectName;
  const circumference = 2 * Math.PI * 22; // r=22 => ~138.23
  const score = META.totalScore;
  const ringArc = document.getElementById('score-ring-arc');
  const offset = circumference * (1 - score / 100);
  const scoreColor = score >= 80 ? '#22d3ee' : score >= 60 ? '#fbbf24' : score >= 40 ? '#f97316' : '#ef4444';
  // Animate ring on load
  setTimeout(function() {
    ringArc.style.strokeDashoffset = offset;
    ringArc.style.stroke = scoreColor;
  }, 300);
  document.getElementById('score-ring-text').textContent = score;

  if (META.truncated) {
    document.getElementById('trunc-warn').classList.add('visible');
    document.getElementById('max-nodes-shown').textContent = META.shownNodes;
  }

  // ── Ambient Particles ─────────────────────────────────────────────────────
  const particleCanvas = document.getElementById('particles');
  const pCtx = particleCanvas.getContext('2d');
  const NUM_PARTICLES = 50;
  const particles = [];

  function resizeParticles() {
    const wrapper = document.getElementById('cy-wrapper');
    particleCanvas.width = wrapper.offsetWidth;
    particleCanvas.height = wrapper.offsetHeight;
  }

  for (let i = 0; i < NUM_PARTICLES; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      opacity: 0.1 + Math.random() * 0.2,
      size: 0.8 + Math.random() * 1.5,
    });
  }

  function animateParticles() {
    const w = particleCanvas.width;
    const h = particleCanvas.height;
    pCtx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      pCtx.fillStyle = 'rgba(34,211,238,' + p.opacity + ')';
      pCtx.fill();
    }
    requestAnimationFrame(animateParticles);
  }

  resizeParticles();
  animateParticles();
  window.addEventListener('resize', resizeParticles);

  // ── Cytoscape init ────────────────────────────────────────────────────────
  const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: ELEMENTS,
    layout: {
      name: 'fcose',
      quality: 'proof',
      animate: true,
      animationDuration: 1000,
      nodeRepulsion: function() { return 8500; },
      idealEdgeLength: function() { return 100; },
      edgeElasticity: function() { return 0.45; },
      gravity: 0.4,
      packComponents: true,
      randomize: true,
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
          'font-family': 'JetBrains Mono, SF Mono, monospace',
          'color': '#94a3b8',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 4,
          'text-outline-color': '#0a0e17',
          'text-outline-width': 2,
          'text-background-color': 'rgba(10,14,23,0.8)',
          'text-background-opacity': 0,
          'border-width': 2,
          'border-color': 'data(borderColor)',
          'min-zoomed-font-size': 8,
          'background-opacity': 0.85,
        },
      },
      {
        selector: 'node[blastRadius > 50]',
        style: {
          'border-width': 3,
          'font-size': 11,
          'font-weight': 600,
          'z-index': 100,
        },
      },
      {
        selector: 'node[score < 30][blastRadius > 30]',
        style: {
          'border-width': 4,
        },
      },
      {
        selector: 'node.highlighted',
        style: {
          'border-color': 'rgba(34,211,238,0.9)',
          'border-width': 3,
          'z-index': 200,
          'background-opacity': 1,
          'text-background-opacity': 0.8,
        },
      },
      {
        selector: 'node.faded',
        style: {
          'opacity': 0.15,
        },
      },
      {
        selector: 'node.hover-faded',
        style: {
          'opacity': 0.12,
        },
      },
      {
        selector: 'node.hover-lit',
        style: {
          'opacity': 1,
          'z-index': 200,
          'background-opacity': 1,
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1,
          'line-color': 'rgba(148,163,184,0.08)',
          'target-arrow-color': 'rgba(148,163,184,0.12)',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 0.6,
          'opacity': 1,
        },
      },
      {
        selector: 'edge[sourceScore < 40]',
        style: {
          'line-color': 'rgba(239,68,68,0.2)',
          'target-arrow-color': 'rgba(239,68,68,0.2)',
          'width': 1.5,
        },
      },
      {
        selector: 'edge.highlighted',
        style: {
          'line-color': 'rgba(34,211,238,0.6)',
          'target-arrow-color': 'rgba(34,211,238,0.6)',
          'width': 2,
          'z-index': 999,
          'opacity': 1,
        },
      },
      {
        selector: 'edge.faded',
        style: { 'opacity': 0.04 },
      },
      {
        selector: 'edge.hover-faded',
        style: { 'opacity': 0.03 },
      },
    ],
    wheelSensitivity: 0.3,
  });

  // ── Staggered entry + pulse animations (after layout) ─────────────────────
  cy.one('layoutstop', function() {
    // Sort nodes high blast-radius first
    const nodeArr = cy.nodes().toArray().sort(function(a, b) {
      return b.data('blastRadius') - a.data('blastRadius');
    });

    // Set all invisible
    nodeArr.forEach(function(node) {
      node.style('opacity', 0);
    });
    cy.edges().style('opacity', 0);

    // Staggered fade-in
    nodeArr.forEach(function(node, i) {
      setTimeout(function() {
        node.animate({ style: { opacity: 1 } }, { duration: 350, easing: 'ease-in' });
      }, i * 20);
    });

    // Fade in edges after nodes
    const edgeDelay = nodeArr.length * 20 + 200;
    setTimeout(function() {
      cy.edges().animate({ style: { opacity: 1 } }, { duration: 500 });
    }, edgeDelay);

    // Pulse low-score nodes
    setTimeout(function() {
      cy.nodes().filter(function(node) {
        return node.data('score') < 30;
      }).forEach(function(node) {
        (function pulse() {
          node.animate(
            { style: { 'background-opacity': 0.6 } },
            { duration: 800, complete: function() {
              node.animate(
                { style: { 'background-opacity': 0.9 } },
                { duration: 800, complete: pulse }
              );
            }}
          );
        })();
      });
    }, edgeDelay + 600);
  });

  updateNodeCount();

  // ── Tooltip ───────────────────────────────────────────────────────────────
  const tooltip = document.getElementById('tooltip');

  cy.on('mouseover', 'node', function (e) {
    const d = e.target.data();
    tooltip.innerHTML =
      '<div class="tt-name">' + escHtml(d.label) + '</div>' +
      '<div class="tt-row"><span class="tt-label">Score</span>&nbsp;' + d.score + '/100</div>' +
      '<div class="tt-row"><span class="tt-label">Issues</span>&nbsp;' + d.issueCount + '</div>' +
      '<div class="tt-row"><span class="tt-label">Blast</span>&nbsp;' + d.blastRadius + '</div>' +
      '<div class="tt-row"><span class="tt-label">Dir</span>&nbsp;' + escHtml(d.directory || '.') + '</div>';
    tooltip.style.display = 'block';
    tooltip.removeAttribute('aria-hidden');

    // Hover: dim non-neighborhood
    if (!activeNode) {
      const neighborhood = e.target.closedNeighborhood();
      cy.elements().not(neighborhood).addClass('hover-faded');
      neighborhood.addClass('hover-lit');
    }
  });

  cy.on('mouseout', 'node', function () {
    tooltip.style.display = 'none';
    tooltip.setAttribute('aria-hidden', 'true');
    if (!activeNode) {
      cy.elements().removeClass('hover-faded hover-lit');
    }
  });

  cy.on('mousemove', function (e) {
    if (tooltip.style.display === 'none') return;
    tooltip.style.left = (e.originalEvent.clientX + 14) + 'px';
    tooltip.style.top  = (e.originalEvent.clientY + 14) + 'px';
  });

  // ── Node click ─────────────────────────────────────────────────────────────
  let activeNode = null;
  const detail      = document.getElementById('detail');
  const detailName  = document.getElementById('detail-name');
  const detailScore = document.getElementById('detail-score');
  const detailIssues = document.getElementById('detail-issues-count');
  const detailBlast = document.getElementById('detail-blast');
  const detailDir   = document.getElementById('detail-dir');
  const detailCats  = document.getElementById('detail-cat-breakdown');

  cy.on('tap', 'node', function (e) {
    const d = e.target.data();
    activeNode = e.target;

    // Clear hover classes
    cy.elements().removeClass('hover-faded hover-lit');

    // Highlight neighbourhood
    cy.elements().removeClass('highlighted faded');
    const neighborhood = e.target.closedNeighborhood();
    cy.elements().not(neighborhood).addClass('faded');
    neighborhood.addClass('highlighted');

    // Smooth zoom to fit neighborhood
    cy.animate({ fit: { eles: neighborhood, padding: 60 } }, { duration: 600 });

    // Populate detail panel
    detailName.textContent = d.label;
    detailScore.textContent = d.score + '/100';
    detailScore.style.color = d.color;
    detailIssues.textContent = d.issueCount;
    detailBlast.textContent = d.blastRadius + ' dependents';
    detailDir.textContent = d.directory || '.';

    const cats = d.issuesByCategory || {};
    const catKeys = Object.keys(cats);
    if (catKeys.length > 0) {
      const rows = catKeys
        .sort(function(a, b) { return cats[b] - cats[a]; })
        .map(function(k) {
          return '<div class="issue-cat">' +
            '<span class="issue-cat-name">' + escHtml(k) + '</span>' +
            '<span class="issue-cat-count">' + cats[k] + '</span>' +
            '</div>';
        }).join('');
      detailCats.innerHTML = '<div class="detail-issues-title">Issues by category</div>' + rows;
    } else {
      detailCats.innerHTML = '';
    }

    detail.classList.add('visible');
  });

  cy.on('tap', function (e) {
    if (e.target === cy) {
      activeNode = null;
      cy.elements().removeClass('highlighted faded hover-faded hover-lit');
      detail.classList.remove('visible');
    }
  });

  // ── Double-click: zoom to fit cluster ─────────────────────────────────────
  cy.on('dblclick', 'node', function(e) {
    const dir = e.target.data('directory');
    const cluster = cy.nodes().filter(function(n) { return n.data('directory') === dir; });
    cy.animate({ fit: { eles: cluster, padding: 40 } }, { duration: 600 });
  });

  // ── Keyboard navigation ───────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      activeNode = null;
      cy.elements().removeClass('highlighted faded hover-faded hover-lit');
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
      const catMatch  = !cat || (d.issuesByCategory &&
        Object.keys(d.issuesByCategory || {}).some(function(k) { return k.toLowerCase().includes(cat); }));
      const rangeMatch = range === 'all' ||
        (range === 'good'    && d.score >= 80) ||
        (range === 'caution' && d.score >= 40 && d.score < 80) ||
        (range === 'danger'  && d.score < 40);

      node.style('display', (nameMatch && catMatch && rangeMatch) ? 'element' : 'none');
    });

    cy.edges().forEach(function (edge) {
      const srcVisible = edge.source().style('display') !== 'none';
      const tgtVisible = edge.target().style('display') !== 'none';
      edge.style('display', srcVisible && tgtVisible ? 'element' : 'none');
    });

    updateNodeCount();
  }

  function updateNodeCount() {
    const visible = cy.nodes().filter(function(n) { return n.style('display') !== 'none'; }).length;
    document.getElementById('node-count').textContent =
      visible + ' of ' + cy.nodes().length + ' files shown';
  }

  // ── Clickable Legend ──────────────────────────────────────────────────────
  const TIER_RANGES = {
    excellent: [90, 101],
    good:      [80, 90],
    warning:   [60, 80],
    caution:   [40, 60],
    danger:    [20, 40],
    critical:  [0,  20],
  };

  let activeTier = null;

  document.querySelectorAll('.legend-item[data-tier]').forEach(function(item) {
    function activate() {
      const tier = item.getAttribute('data-tier');
      if (activeTier === tier) {
        // Toggle off — show all
        activeTier = null;
        document.querySelectorAll('.legend-item').forEach(function(el) { el.classList.remove('active'); });
        cy.nodes().style('display', 'element');
        cy.edges().style('display', 'element');
        updateNodeCount();
        return;
      }
      activeTier = tier;
      document.querySelectorAll('.legend-item').forEach(function(el) { el.classList.remove('active'); });
      item.classList.add('active');

      const range = TIER_RANGES[tier];
      cy.nodes().forEach(function(node) {
        const s = node.data('score');
        node.style('display', (s >= range[0] && s < range[1]) ? 'element' : 'none');
      });
      cy.edges().forEach(function(edge) {
        const srcOk = edge.source().style('display') !== 'none';
        const tgtOk = edge.target().style('display') !== 'none';
        edge.style('display', srcOk && tgtOk ? 'element' : 'none');
      });
      updateNodeCount();
    }

    item.addEventListener('click', activate);
    item.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });

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
