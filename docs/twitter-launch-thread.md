# X/Twitter Launch Thread

## Tweet 1 (Hook)
I built a CLI that scores your codebase 0-100, then autonomously fixes the issues it finds.

Every fix is tested. Every fix is committed. If tests fail, it reverts.

Like a ratchet wrench — it only turns one way. 🔧

Introducing Ratchet → ratchetcli.com

## Tweet 2 (How it works)
How it works:

$ ratchet scan → score across 6 categories (free)
$ ratchet torque --clicks 7 → run 7 AI improvement cycles

Each "click" = analyze → propose → build → test → commit

Green? Committed. Red? Reverted. Your code literally cannot get worse.

## Tweet 3 (Real results)
Real results on a 15K-line TypeScript app:

76/100 → 86/100

• Migrated 166 console.* calls to Pino across 14 files
• Split a 2000-line god file into 13 modules
• Fixed 6 overly-broad rate limiters
• 1,280 tests passing the entire time

Every single commit was made by Ratchet.

## Tweet 4 (Honesty — this is the one that gets shared)
Being honest about what doesn't work:

• Score plateaus at ~85. Diminishing returns are real.
• One run introduced an infinite recursion bug (it self-corrected 2 clicks later)
• 5/7 clicks rolled back in one session
• 700 duplicated lines need human decisions, not AI

The guard system is the product. The AI is the engine.

## Tweet 5 (Features)
What makes it different from a linter:

🛡️ Guard profiles — tight/refactor/broad/atomic
📋 Plan-first mode — AI reads before it writes
🏗️ Architect mode — cross-cutting refactors
💰 Per-click economics — cost per improvement
🔭 Vision — interactive quality heatmap
🔒 BYOK — your API key, your model

## Tweet 6 (Anti-feature hook)
What Ratchet WON'T do:

❌ Won't commit code that fails tests
❌ Won't touch files outside your scope
❌ Won't skip your test suite
❌ Won't send your code anywhere (BYOK)
❌ Won't promise a perfect score

We built boundaries because we run this on production code.

## Tweet 7 (CTA)
Free forever: ratchet scan (unlimited)
Builder: $19/mo (30 improvement cycles)
Pro: $49/mo (150 cycles)

npm install -g ratchet-run

What's your score? Reply with your repo and I'll scan it. 👇

ratchetcli.com
