# X/Twitter Launch Thread

## Tweet 1 (Hook)
I built a CLI that scores your codebase 0-100, then autonomously fixes the issues it finds.

Every fix is tested. Every fix is committed. If tests fail, it reverts.

The ratchet only turns one way. 🔧

Introducing Ratchet → ratchetcli.com

## Tweet 2 (How it works)
How it works:

$ ratchet scan → score your code across 8 dimensions
$ ratchet torque -c 7 → run 7 AI-powered fix cycles

Each "click" = analyze → propose → build → test → commit

Green? Committed. Red? Reverted. Your code literally cannot get worse.

## Tweet 3 (Real results)
Real results on a 15K-line TypeScript app:

76/100 → 86/100

• Migrated logging across 14 files
• Split a 2000-line god file into 13 modules
• Fixed 6 overly-broad rate limiters
• 891 tests passing the entire time

Every single commit was made by Ratchet.

## Tweet 4 (Key features)
Features that make it different:

🛡️ Guard profiles — control how much changes per cycle
📋 Plan-first mode — AI reads before it writes
🏗️ Architect mode — cross-cutting refactors
💰 Per-click economics — cost, time, ROI per cycle
🔭 Vision — interactive quality heatmap

## Tweet 5 (CTA)
Free: `ratchet scan` (unlimited, no API key)
Paid: `ratchet torque` (BYOK, from $12/mo)

852 tests. TypeScript. Git-native.

Try it: npm install -g @ratchet-run/cli

Star it: github.com/giovanni-labs/ratchet

What's your score? 👇
