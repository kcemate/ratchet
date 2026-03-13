# Ratchet Landing Page — UI Sprint Log

7 clicks of visual polish on `site/index.html`.

---

## Click 1 — Terminal window glow + output line stagger animation
**Status:** ✅ Done
**Commit:** `c57b6bf`
Added ambient amber glow (`box-shadow`) to the terminal window that intensifies on hover. Each output line now fades+slides in sequentially (120ms stagger) after the typing animation completes.

---

## Click 2 — Click-step cards: accent left border + hover lift
**Status:** ✅ Done
**Commit:** `16c7957`
Added a 3px amber left border to all click-step cards (dimmed at rest). On hover: border brightens to full accent, card slides 4px right, subtle glow appears — reinforcing the directional "forward motion" theme of Ratchet.

---

## Click 3 — CTA buttons: gradient fill, glow shadow, lift-on-hover
**Status:** ✅ Done
**Commit:** `1a542dd`
Primary `.btn` upgraded from flat amber fill to a 135° gradient (`#f59e0b → #d97706`), with an amber drop shadow. Hover state: lifts 2px, scales 1.02×, box-shadow expands. Active state: subtle press-down. Secondary button gets a matching hover with border glow.

---

## Click 4 — Section heading accent underline gradient
**Status:** ✅ Done
**Commit:** `fd3b306`
The highlighted `<span>` word in each section `h2` (e.g. "click", "results", "questions") now has a 2px underline with a left-to-right amber→transparent gradient, adding visual emphasis and design consistency across sections.

---

## Click 5 — Stats section: animated number counters on scroll-in
**Status:** ✅ Done
**Commit:** `3d0e7ff`
Numbers (100+, 496, 0) animate from 0 to their target values using a cubic-ease-out curve over 1.2 seconds when the stats section enters the viewport. Stat cards also get a subtle hover border glow. Numbers use `tabular-nums` for stable layout during animation.

---

## Click 6 — Pawl box glowing gradient + testimonial hover lift
**Status:** ✅ Done
**Commit:** `e378f43`
Pawl box upgraded with: amber left border (3px solid), subtle amber-tinted background gradient, inset top highlight, radial glow in top-right corner. Testimonial cards get `transform: translateY(-3px)` + shadow lift on hover, making the social proof section more interactive.

---

## Click 7 — Mobile polish at 375px, smooth scroll, sticky nav
**Status:** ✅ Done
**Commit:** `58f46d4`
Added `html { scroll-behavior: smooth }`. Added `@media (max-width: 375px)` breakpoint with tighter padding, smaller fonts, reduced stat numbers. Terminal gets tighter border-radius and smaller font on mobile. Added a sticky nav bar (backdrop-blur glass) that slides down after scrolling past the hero — provides persistent GitHub CTA without cluttering the landing view.

---

## Summary

All 7 UI polish clicks complete. Key improvements:
- Terminal feels alive (glow, staggered output animation)
- Click-step cards reinforce the "forward motion" brand with directional hover
- Buttons are premium (gradient + glow + physics-like press)
- Section headers have typographic accent marks
- Stats section engages on scroll with counting animation
- Pawl box has appropriate visual weight as a key differentiator
- Mobile layout tuned to 375px, plus sticky nav for secondary CTA exposure
