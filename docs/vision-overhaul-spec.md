# Ratchet Vision — Cyberpunk Visual Overhaul Spec

## Source
Grok 4.2 Reasoning design review. Implementing full visual overhaul.

## Color Palette (replace current flat colors)
```
--bg-primary: #0a0e17
--bg-secondary: #0f1419
--bg-elevated: #151c28
--bg-grid: rgba(34, 211, 238, 0.03)

Score colors (luminous, not flat):
- Excellent (>90): #00ff88 (neon mint), glow rgba(0,255,136,0.5)
- Good (>80): #22d3ee (cyan), glow rgba(34,211,238,0.4)
- Warning (>60): #fbbf24 (amber), glow rgba(251,191,36,0.35)
- Caution (>40): #f97316 (orange), glow rgba(249,115,22,0.4)
- Danger (>20): #ef4444 (red), glow rgba(239,68,68,0.45)
- Critical (<20): #ff2d55 (hot pink), glow rgba(255,45,85,0.6)

--accent-primary: #6366f1 (indigo)
--accent-secondary: #8b5cf6 (purple)
--edge-default: rgba(148, 163, 184, 0.15)
--edge-highlight: rgba(34, 211, 238, 0.8)
--text-primary: #f1f5f9
--text-secondary: #94a3b8
--text-muted: #475569
```

## Layout
- Switch from `cose` to `fcose` layout (need to add cytoscape-fcose extension)
  - CDN: https://unpkg.com/cytoscape-fcose@2/cytoscape-fcose.js
  - quality: 'proof', animate: true, animationDuration: 1000
  - nodeRepulsion: 8500, idealEdgeLength: 100, edgeElasticity: 0.45
  - gravity: 0.4, packComponents: true
- High blast-radius nodes gravitate to center
- Cluster by directory

## Node Styling
- Multi-layer fill: background-color + border as "rim light"
- Border width 2, border color matches node color at 0.6 opacity
- High blast radius (>50): border-width 3, font-size 11, font-weight 600, z-index 100
- Critical nodes (score <30 + blast >30): border-width 4, border-style double
- Animated PULSE for score <30 nodes: oscillate background-opacity between 0.6 and 0.9 over 800ms
- Labels: JetBrains Mono (https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700)
- Text background with 0.8 opacity for readability

## Edge Styling
- Default: width 1, line-color rgba(148,163,184,0.08), bezier curves
- Arrow scale 0.6, very subtle
- Edges from critical nodes (source score <40): rgba(239,68,68,0.2), width 1.5
- Highlighted edges: rgba(34,211,238,0.6), width 2, z-index 999

## Background & Atmosphere
- Radial gradient center glow: rgba(99,102,241,0.08) -> transparent
- Grid pattern: 40px grid at 3% opacity cyan
- Vignette overlay: transparent center -> rgba(10,14,23,0.7) edges
- Floating ambient particles: 50 particles, cyan, varying opacity 0.1-0.3, slow drift
  - Render on a canvas layer BEHIND the Cytoscape container

## SVG Glow Filter
Add an SVG filter definition for gaussian blur glow on nodes:
```html
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
```

## Interactions
- Hover node → dim everything EXCEPT its closed neighborhood (opacity 0.15 for faded)
- Hover also highlights edges in neighborhood with cyan glow
- Click node → smooth animated zoom-to-fit on neighborhood
- Staggered entry animation on load: nodes fade in from highest blast-radius outward, 20ms delay between each
- Double-click node → zoom to fit that cluster

## Sidebar & Chrome
- Font: Inter for UI, JetBrains Mono for file names
  - https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600
- Score as radial progress ring SVG (not plain text)
- Legend items are clickable (click green → isolate green nodes)
- Minimap in bottom-right corner (use cy.container overlay canvas)
- Sidebar background: #0f1419, elevated panels: #151c28

## Typography CSS
```css
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```
