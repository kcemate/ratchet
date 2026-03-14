# ⚙ Ratchet Run 4 — PDF UI (clicks 32-38)

Analyzing the screenshot. Dark theme is solid. Two critical issues.

---

## Click 32: Giant empty space at bottom — the #1 problem

The bottom 40% of the PDF is completely blank. The content ends halfway down the page. The auto-height measurement isn't working — Puppeteer is printing a full A4 page regardless.

**Improvement:** Switch from fixed A4 to content-height PDF. In Puppeteer, use `printBackground: true`, `width: '794px'`, and `height` set dynamically from `document.body.scrollHeight`. Remove `format: 'A4'` entirely. The PDF should be exactly as tall as the content.

**Tests pass?** ✓

---

## Click 33: Score hero needs more drama

The 71 → 84 section is good but the numbers feel small relative to the available space. The amber progress bar is the strongest visual element but the numbers (71 and 84) could be 96px+. The +13 badge is too small to be the hero it should be.

**Improvement:** Make before score 80px gray, after score 120px bright white. +13 badge should be 24px font, pill shape, 2x larger. Add a subtle amber radial glow radiating from the "84".

**Tests pass?** ✓

---

## Click 34: Summary bar boxes feel disconnected

The 4 stat boxes (7 CLICKS / 6 LANDED / 1 ROLLED BACK / 5m 12s) look okay but the borders are weak. They feel like separate items instead of one cohesive bar.

**Improvement:** Give the entire summary bar one dark card background. Remove individual box borders. Use subtle divider lines between stats instead. Makes it feel like one unit, not 4 separate things.

**Tests pass?** ✓

---

## Click 35: Category progress bars — before bars too similar to after

Looking at the screenshot: both before and after bars are similar length for most categories. Testing shows 15/17 before and 16/17 after — nearly the same bar length. The visual doesn't dramatize the improvement enough.

**Improvement:** Make the before bar always render at the raw score percentage (capped). After bar renders at after score. For small improvements the bars will look similar — that's honest. But add an animated-looking "glow" on the after bar to make it feel alive vs the dead gray before bar.

**Tests pass?** ✓ — Can't fix reality but can make the contrast clearer.

---

## Click 36: Two-column layout for improvements breaks on some runs

The "What Improved" and "What Was Rolled Back" side by side looks good when both have items. But when nothing was rolled back, the right column is empty and looks broken. Also the columns are too narrow — text wraps awkwardly.

**Improvement:** Only use two-column layout when both sections have items. If rolled back is empty, show "Nothing was rolled back — clean run 🎉" in a single full-width section. When two columns, ensure minimum column width.

**Tests pass?** ✓

---

## Click 37: Header gear icon is getting cut off

From the screenshot, the left side is slightly clipped. The gear icon position may be too close to the left edge. Also the header gradient text isn't showing — it may be falling back to plain text.

**Improvement:** Add more left padding (56px instead of 40px). Ensure CSS gradient text works in Puppeteer (add -webkit-background-clip: text). Test with a known-working gradient text approach.

**Tests pass?** ✓

---

## Click 38: Verify all changes, regenerate PDF

After all 6 changes, the PDF should:
- Be content-height (no empty space at bottom)
- Have a dramatic 71→84 hero score
- Have a cohesive summary bar (one card, dividers)
- Have the content properly padded from edges
- Handle edge cases in the two-column layout

**Tests pass?** ✓
