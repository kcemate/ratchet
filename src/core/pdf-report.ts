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
const GREEN = '#22c55e';
const RED = '#ef4444';

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
  return raw.slice(0, 120).trimEnd() + (raw.length > 120 ? '…' : '');
}

/**
 * Generate a polished PDF Buffer from the report data.
 */
export async function generatePDF(options: ReportOptions): Promise<Buffer> {
  const { run, scoreBefore, scoreAfter } = options;

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
    // Logo + title row
    doc
      .fontSize(28)
      .fillColor(AMBER)
      .font('Helvetica-Bold')
      .text('⚙', margin, y, { continued: true })
      .fillColor(WHITE)
      .text('  Ratchet Report', { continued: false });

    y += 36;

    // Date
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.fontSize(11).fillColor(GRAY).font('Helvetica').text(dateStr, margin, y);

    y += 28;

    // Divider line
    doc
      .moveTo(margin, y)
      .lineTo(pageWidth - margin, y)
      .strokeColor(AMBER)
      .lineWidth(1.5)
      .stroke();

    y += 20;

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

    y += 72;

    // --- What improved ---
    doc
      .fontSize(14)
      .fillColor(AMBER)
      .font('Helvetica-Bold')
      .text('What improved', margin, y);

    y += 22;

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
        const bulletText = `Click ${click.number}  —  ${summary}`;

        // Bullet dot
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

    y += 12;

    // --- What was rolled back ---
    doc
      .fontSize(14)
      .fillColor(AMBER)
      .font('Helvetica-Bold')
      .text('What was rolled back', margin, y);

    y += 22;

    if (rolledBack.length === 0) {
      doc
        .fontSize(11)
        .fillColor(GREEN)
        .font('Helvetica')
        .text('Nothing was rolled back — clean run!', margin + 12, y);
      y += 18;
    } else {
      for (const click of rolledBack) {
        const reason = click.analysis
          ? (click.analysis.split(/[.!\n]/)[0]?.trim() ?? 'Tests failed')
          : 'Tests failed';
        const bulletText = `Click ${click.number}  —  ${reason.slice(0, 120)}`;

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

    y += 16;

    // --- Production Readiness Score ---
    if (scoreBefore && scoreAfter) {
      const beforePct = Math.round((scoreBefore.total / scoreBefore.maxTotal) * 100);
      const afterPct = Math.round((scoreAfter.total / scoreAfter.maxTotal) * 100);
      const delta = afterPct - beforePct;
      const deltaStr = delta > 0 ? `+${delta}` : String(delta);
      const deltaColor = delta > 0 ? GREEN : delta < 0 ? RED : GRAY;

      // Section header
      doc
        .fontSize(14)
        .fillColor(AMBER)
        .font('Helvetica-Bold')
        .text('Production Readiness Score', margin, y);

      y += 22;

      // Big score card
      const cardH = 72;
      doc.rect(margin, y, contentWidth, cardH).fill(DARK_CARD);

      // Before score
      doc
        .fontSize(36)
        .fillColor(GRAY)
        .font('Helvetica-Bold')
        .text(String(beforePct), margin + 24, y + 12, { width: 80, align: 'center' });

      doc
        .fontSize(9)
        .fillColor(GRAY)
        .font('Helvetica')
        .text('BEFORE', margin + 24, y + 54, { width: 80, align: 'center' });

      // Arrow
      doc
        .fontSize(24)
        .fillColor(AMBER)
        .font('Helvetica')
        .text('→', margin + contentWidth / 2 - 16, y + 20, { width: 32, align: 'center' });

      // After score
      doc
        .fontSize(36)
        .fillColor(WHITE)
        .font('Helvetica-Bold')
        .text(String(afterPct), pageWidth - margin - 104, y + 12, { width: 80, align: 'center' });

      doc
        .fontSize(9)
        .fillColor(GRAY)
        .font('Helvetica')
        .text('AFTER', pageWidth - margin - 104, y + 54, { width: 80, align: 'center' });

      // Delta badge
      const badgeX = margin + contentWidth / 2 - 24;
      const badgeY = y + 44;
      doc.rect(badgeX, badgeY, 48, 18).fill(deltaColor);
      doc
        .fontSize(10)
        .fillColor(WHITE)
        .font('Helvetica-Bold')
        .text(deltaStr, badgeX, badgeY + 3, { width: 48, align: 'center' });

      y += cardH + 20;

      // --- Category breakdown ---
      doc
        .fontSize(14)
        .fillColor(AMBER)
        .font('Helvetica-Bold')
        .text('Category Breakdown', margin, y);

      y += 22;

      // Table header
      const col = {
        emoji: margin,
        name: margin + 28,
        before: margin + contentWidth - 140,
        after: margin + contentWidth - 80,
        change: margin + contentWidth - 28,
      };

      doc
        .fontSize(8)
        .fillColor(GRAY)
        .font('Helvetica')
        .text('BEFORE', col.before - 10, y, { width: 60, align: 'right' })
        .text('AFTER', col.after - 10, y, { width: 60, align: 'right' })
        .text('Δ', col.change - 4, y, { width: 24, align: 'right' });

      y += 14;

      for (let i = 0; i < scoreBefore.categories.length; i++) {
        const before = scoreBefore.categories[i];
        const after = scoreAfter.categories[i];
        if (!before || !after) continue;

        const catDelta = after.score - before.score;
        const catDeltaStr = catDelta > 0 ? `+${catDelta}` : String(catDelta);
        const catDeltaColor = catDelta > 0 ? GREEN : catDelta < 0 ? RED : GRAY;
        const rowBg = i % 2 === 0 ? DARK_CARD : BG;

        doc.rect(margin, y - 2, contentWidth, 22).fill(rowBg);

        doc
          .fontSize(11)
          .fillColor(WHITE)
          .font('Helvetica')
          .text(after.emoji, col.emoji, y + 2, { width: 24 });

        doc
          .fontSize(10)
          .fillColor(WHITE)
          .font('Helvetica')
          .text(after.name, col.name, y + 3, { width: 180 });

        doc
          .fontSize(10)
          .fillColor(GRAY)
          .text(`${before.score}/${before.max}`, col.before - 10, y + 3, { width: 60, align: 'right' });

        doc
          .fillColor(WHITE)
          .text(`${after.score}/${after.max}`, col.after - 10, y + 3, { width: 60, align: 'right' });

        doc
          .fillColor(catDeltaColor)
          .font('Helvetica-Bold')
          .text(catDeltaStr, col.change - 4, y + 3, { width: 24, align: 'right' });

        y += 22;
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
      .text('Generated by Ratchet · ratchetcli.com', margin, footerY, {
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
