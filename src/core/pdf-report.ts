import PDFDocument from 'pdfkit';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { RatchetRun, Click } from '../types.js';
import type { ScanResult } from '../commands/scan.js';

export type { ReportOptions } from './report.js';
import type { ReportOptions } from './report.js';

// Color palette matching the landing page
const BG = '#0a0a0b';
const AMBER = '#f59e0b';
const WHITE = '#ffffff';
const GRAY = '#6b7280';
const DARK_CARD = '#111113';
const DARK_BAR = '#1a1a1e';
const GREEN = '#22c55e';
const RED = '#ef4444';

// Category dot colors
const CATEGORY_COLORS: Record<string, string> = {
  'Testing': '#3b82f6',
  'Error Handling': '#f97316',
  'Types': '#a855f7',
  'Security': '#ef4444',
  'Performance': '#eab308',
  'Readability': '#22c55e',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function plainEnglishSummary(click: Click): string {
  const raw = click.proposal || click.analysis || '';
  if (!raw) return 'Applied code improvements';
  const firstSentence = raw.split(/[.!\n]/)[0]?.trim() ?? '';
  if (firstSentence.length > 0 && firstSentence.length <= 120) return firstSentence;
  return raw.slice(0, 120).trimEnd() + (raw.length > 120 ? '...' : '');
}

/**
 * Generate a polished PDF Buffer from the report data.
 */
export async function generatePDF(options: ReportOptions): Promise<Buffer> {
  const { run, scoreBefore, scoreAfter } = options;
  const projectName = (options as any).projectName ?? run.target.name;
  const targetName = run.target.name;

  const totalClicks = run.clicks.length;
  const landed = run.clicks.filter((c) => c.testsPassed);
  const rolledBack = run.clicks.filter((c) => !c.testsPassed);
  const durationMs = run.finishedAt
    ? run.finishedAt.getTime() - run.startedAt.getTime()
    : 0;
  const duration = formatDuration(durationMs);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;

    // --- Full background ---
    doc.rect(0, 0, pageWidth, pageHeight).fill(BG);

    let y = margin;

    // --- Header ---
    doc
      .fontSize(28)
      .fillColor(AMBER)
      .font('Helvetica-Bold')
      .text('Ratchet Report', margin, y);

    y += 34;

    // Date + project/target
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.fontSize(11).fillColor(GRAY).font('Helvetica').text(dateStr, margin, y);

    y += 18;

    doc
      .fontSize(10)
      .fillColor(GRAY)
      .font('Helvetica')
      .text(`Project: ${projectName} / Target: ${targetName}`, margin, y);

    y += 20;

    // Divider line
    doc
      .moveTo(margin, y)
      .lineTo(pageWidth - margin, y)
      .strokeColor(AMBER)
      .lineWidth(1.5)
      .stroke();

    y += 18;

    // --- Summary bar ---
    doc
      .rect(margin, y, contentWidth, 56)
      .fill(DARK_CARD);

    const summaryItems = [
      { label: 'CLICKS', value: String(totalClicks) },
      { label: 'LANDED', value: String(landed.length) },
      { label: 'ROLLED BACK', value: String(rolledBack.length) },
      { label: 'DURATION', value: duration },
    ];

    const colWidth = contentWidth / summaryItems.length;
    for (let i = 0; i < summaryItems.length; i++) {
      const item = summaryItems[i]!;
      const cx = margin + i * colWidth + colWidth / 2;

      doc
        .fontSize(18)
        .fillColor(i === 1 ? GREEN : i === 2 && rolledBack.length > 0 ? RED : AMBER)
        .font('Helvetica-Bold')
        .text(item.value, cx - 40, y + 8, { width: 80, align: 'center' });

      doc
        .fontSize(8)
        .fillColor(GRAY)
        .font('Helvetica')
        .text(item.label, cx - 40, y + 36, { width: 80, align: 'center' });
    }

    y += 70;

    // --- Production Readiness Score (hero — above what improved) ---
    if (scoreBefore && scoreAfter) {
      const beforePct = Math.round((scoreBefore.total / scoreBefore.maxTotal) * 100);
      const afterPct = Math.round((scoreAfter.total / scoreAfter.maxTotal) * 100);
      const delta = afterPct - beforePct;
      const deltaStr = delta > 0 ? `+${delta}` : String(delta);
      const deltaColor = delta > 0 ? GREEN : delta < 0 ? RED : GRAY;

      doc
        .fontSize(14)
        .fillColor(AMBER)
        .font('Helvetica-Bold')
        .text('Production Readiness Score', margin, y);

      y += 20;

      const cardH = 100;
      doc.rect(margin, y, contentWidth, cardH).fill(DARK_CARD);

      const sectionW = contentWidth / 3;
      const barW = sectionW - 28;
      const barH = 10;
      const barY = y + 82;

      // Before side
      const beforeX = margin + 14;
      doc
        .fontSize(9)
        .fillColor(GRAY)
        .font('Helvetica')
        .text('BEFORE', beforeX, y + 8, { width: sectionW - 14 });

      doc
        .fontSize(48)
        .fillColor(GRAY)
        .font('Helvetica-Bold')
        .text(String(beforePct), beforeX, y + 20, { width: sectionW - 14 });

      doc.rect(beforeX, barY, barW, barH).fill(DARK_BAR);
      const beforeFill = Math.max(3, (beforePct / 100) * barW);
      doc.rect(beforeX, barY, beforeFill, barH).fill(GRAY);

      // Center: arrow + delta
      const arrowX = margin + sectionW;
      doc
        .fontSize(20)
        .fillColor(AMBER)
        .font('Helvetica-Bold')
        .text('->', arrowX, y + 32, { width: sectionW, align: 'center' });

      const badgeW = 48;
      const badgeX = arrowX + (sectionW - badgeW) / 2;
      const badgeY = y + 66;
      doc.rect(badgeX, badgeY, badgeW, 18).fill(deltaColor);
      doc
        .fontSize(10)
        .fillColor(WHITE)
        .font('Helvetica-Bold')
        .text(deltaStr, badgeX, badgeY + 3, { width: badgeW, align: 'center' });

      // After side
      const afterX = margin + sectionW * 2 + 14;
      doc
        .fontSize(9)
        .fillColor(GRAY)
        .font('Helvetica')
        .text('AFTER', afterX, y + 8, { width: sectionW - 14 });

      doc
        .fontSize(48)
        .fillColor(WHITE)
        .font('Helvetica-Bold')
        .text(String(afterPct), afterX, y + 20, { width: sectionW - 14 });

      doc.rect(afterX, barY, barW, barH).fill(DARK_BAR);
      const afterFill = Math.max(3, (afterPct / 100) * barW);
      doc.rect(afterX, barY, afterFill, barH).fill(AMBER);

      y += cardH + 16;

      // --- Category breakdown ---
      doc
        .fontSize(14)
        .fillColor(AMBER)
        .font('Helvetica-Bold')
        .text('Category Breakdown', margin, y);

      y += 20;

      // Column positions
      const dotX = margin;
      const nameX = margin + 18;
      const nameW = 148;
      const miniBarW = 100;
      const miniBarH = 7;
      const beforeBarX = margin + 172;
      const beforeNumX = beforeBarX + miniBarW + 4;
      const afterBarX = beforeNumX + 36;
      const afterNumX = afterBarX + miniBarW + 4;
      const changeX = afterNumX + 36;

      // Table header
      doc
        .fontSize(8)
        .fillColor(GRAY)
        .font('Helvetica')
        .text('BEFORE', beforeBarX, y, { width: miniBarW + 36, align: 'center' })
        .text('AFTER', afterBarX, y, { width: miniBarW + 36, align: 'center' })
        .text('CHG', changeX, y, { width: 30, align: 'right' });

      y += 12;

      for (let i = 0; i < scoreBefore.categories.length; i++) {
        const before = scoreBefore.categories[i];
        const after = scoreAfter.categories[i];
        if (!before || !after) continue;

        const catDelta = after.score - before.score;
        const catDeltaStr = catDelta > 0 ? `+${catDelta}` : String(catDelta);
        const catDeltaColor = catDelta > 0 ? GREEN : catDelta < 0 ? RED : GRAY;
        const rowBg = i % 2 === 0 ? DARK_CARD : BG;

        doc.rect(margin, y - 2, contentWidth, 24).fill(rowBg);

        // Colored dot instead of emoji
        const dotColor = CATEGORY_COLORS[after.name] ?? GRAY;
        doc.circle(dotX + 6, y + 8, 5).fill(dotColor);

        doc
          .fontSize(10)
          .fillColor(WHITE)
          .font('Helvetica')
          .text(after.name, nameX, y + 3, { width: nameW });

        // Before mini bar
        const rowBarY = y + 5;
        doc.rect(beforeBarX, rowBarY, miniBarW, miniBarH).fill(DARK_BAR);
        const beforeBarFill = before.max > 0
          ? Math.max(2, (before.score / before.max) * miniBarW)
          : 2;
        doc.rect(beforeBarX, rowBarY, beforeBarFill, miniBarH).fill(GRAY);

        doc
          .fontSize(9)
          .fillColor(GRAY)
          .font('Helvetica')
          .text(`${before.score}/${before.max}`, beforeNumX, y + 3, { width: 32, align: 'right' });

        // After mini bar
        doc.rect(afterBarX, rowBarY, miniBarW, miniBarH).fill(DARK_BAR);
        const afterBarFill = after.max > 0
          ? Math.max(2, (after.score / after.max) * miniBarW)
          : 2;
        doc.rect(afterBarX, rowBarY, afterBarFill, miniBarH).fill(GREEN);

        doc
          .fillColor(WHITE)
          .text(`${after.score}/${after.max}`, afterNumX, y + 3, { width: 32, align: 'right' });

        doc
          .fillColor(catDeltaColor)
          .font('Helvetica-Bold')
          .text(catDeltaStr, changeX, y + 3, { width: 30, align: 'right' });

        y += 24;
      }

      y += 14;
    }

    // --- What improved ---
    doc
      .fontSize(14)
      .fillColor(AMBER)
      .font('Helvetica-Bold')
      .text('What improved', margin, y);

    y += 20;

    if (landed.length === 0) {
      doc
        .fontSize(11)
        .fillColor(GRAY)
        .font('Helvetica')
        .text('Nothing landed this run.', margin + 12, y);
      y += 18;
    } else {
      for (const click of landed) {
        const summary = plainEnglishSummary(click);
        const bulletText = `Click ${click.number}  -  ${summary}`;

        doc
          .circle(margin + 6, y + 5, 3)
          .fill(AMBER);

        doc
          .fontSize(10)
          .fillColor(WHITE)
          .font('Helvetica')
          .text(bulletText, margin + 18, y, { width: contentWidth - 18 });

        y += doc.heightOfString(bulletText, { width: contentWidth - 18 }) + 6;
      }
    }

    y += 10;

    // --- What was rolled back ---
    doc
      .fontSize(14)
      .fillColor(AMBER)
      .font('Helvetica-Bold')
      .text('What was rolled back', margin, y);

    y += 20;

    if (rolledBack.length === 0) {
      doc
        .fontSize(11)
        .fillColor(GREEN)
        .font('Helvetica')
        .text('Nothing was rolled back - clean run!', margin + 12, y);
      y += 18;
    } else {
      for (const click of rolledBack) {
        const reason = click.analysis
          ? (click.analysis.split(/[.!\n]/)[0]?.trim() ?? 'Tests failed')
          : 'Tests failed';
        const bulletText = `Click ${click.number}  -  ${reason.slice(0, 120)}`;

        doc
          .circle(margin + 6, y + 5, 3)
          .fill(RED);

        doc
          .fontSize(10)
          .fillColor(WHITE)
          .font('Helvetica')
          .text(bulletText, margin + 18, y, { width: contentWidth - 18 });

        y += doc.heightOfString(bulletText, { width: contentWidth - 18 }) + 6;
      }
    }

    // --- Footer ---
    const footerY = pageHeight - margin - 20;

    doc
      .moveTo(margin, footerY - 12)
      .lineTo(pageWidth - margin, footerY - 12)
      .strokeColor(GRAY)
      .lineWidth(0.5)
      .stroke();

    doc
      .fontSize(9)
      .fillColor(GRAY)
      .font('Helvetica')
      .text('Generated by Ratchet - Scan your project free at ratchetcli.com', margin, footerY, {
        width: contentWidth,
        align: 'center',
      });

    doc.end();
  });
}

/**
 * Write the PDF report to docs/<target>-ratchet-report.pdf.
 * Returns the path to the written file.
 */
export async function writePDF(options: ReportOptions): Promise<string> {
  const { run, cwd } = options;
  const pdfPath = join(cwd, 'docs', `${run.target.name}-ratchet-report.pdf`);
  const buffer = await generatePDF(options);
  await mkdir(dirname(pdfPath), { recursive: true });
  await writeFile(pdfPath, buffer);
  return pdfPath;
}
