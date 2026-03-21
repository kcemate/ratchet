# Ratchet Sandbox — "Try It Now" Spec

## Overview
A browser-based sandbox that lets visitors run `ratchet scan` on a sample project without installing anything. One click from the landing page → instant score results. Goal: convert visitors by showing, not telling.

## User Flow
1. User clicks **"Try It Now"** CTA on landing page
2. Opens a fullscreen terminal-style UI (modal or new page)
3. A pre-loaded sample TypeScript project is already "scanned"
4. Animated terminal shows `ratchet scan` output rendering in real-time (typewriter effect)
5. Score breakdown appears: 62/100 with per-category bars
6. CTA: **"Now imagine this on YOUR codebase → Install Ratchet"**

## Two Tiers

### Tier 1 — Simulated Sandbox (ship first)
- **No backend required.** Pure frontend.
- Pre-recorded scan output rendered as a terminal animation
- 3 sample projects to choose from:
  - `express-api/` — messy Express app (score 52)
  - `react-dashboard/` — React app with tech debt (score 67)
  - `clean-library/` — well-maintained lib (score 91)
- User picks a project → terminal animates the scan → score appears
- Interactive: user can click categories to expand subcategory details
- After scan completes, show a "torque preview" — animated diff of what Ratchet would fix

**Tech:** Single HTML file (self-contained like vision.ts output). CSS terminal styling, JS typewriter animation. No dependencies.

**Effort:** ~1 day. Ship as `/sandbox` route on ratchetcli.com.

### Tier 2 — Live Sandbox (future)
- **Real `ratchet scan` running server-side** on user-uploaded code
- Cloudflare Worker or Railway micro-service
- User pastes a GitHub repo URL → worker clones, scans, returns results
- Rate-limited: 3 scans/day for anonymous, 10 for signed-in
- Results cached by repo+commit SHA

**Tech:** Cloudflare Worker + `ratchet scan --output-json`. Needs scan to run without license (already free tier).

**Effort:** ~3-5 days. Requires scan binary compiled for Worker runtime or a persistent container.

## Landing Page Integration
```html
<!-- Add after hero section -->
<section id="sandbox">
  <div class="container">
    <h2>See it in action</h2>
    <p>Pick a sample project. Watch Ratchet score it.</p>
    <div class="project-selector">
      <button data-project="express-api">Express API (52/100)</button>
      <button data-project="react-dashboard">React Dashboard (67/100)</button>
      <button data-project="clean-library">Clean Library (91/100)</button>
    </div>
    <div class="terminal-sandbox">
      <!-- Animated scan output renders here -->
    </div>
    <a href="#pricing" class="cta">Now run it on YOUR code →</a>
  </div>
</section>
```

## Pre-recorded Scan Data
Each sample project needs:
- `scan-output.json` — full ScanResult with categories, subcategories, file scores
- `terminal-frames[]` — line-by-line terminal output with timing (ms delay per line)
- `torque-preview` — 2-3 example diffs showing what Ratchet would fix

## Design
- Same dark theme as landing page (cyan/indigo neon)
- Terminal uses JetBrains Mono
- Score bars animate in with the same glassmorphic style
- Category cards expandable on click
- Smooth transition from landing page (no page reload for Tier 1)

## Success Metrics
- % of landing page visitors who click "Try It Now"
- % who proceed to Install or Pricing after sandbox
- Time spent in sandbox (target: 15-30 seconds)

## Priority
Ship Tier 1 first. It's the 80/20 — most of the conversion impact with zero infrastructure. Tier 2 is a nice-to-have for when we have paying users requesting it.
