# Ratchet Launch Posts

## 1. Hacker News "Show HN" Post

**Title:** Show HN: Ratchet – AI that fixes code without breaking it

**Body:**
I built Ratchet because I was tired of AI coding tools that break working code. You know the drill: AI suggests a "fix," you apply it, tests fail, you spend 30 minutes debugging what wasn't broken.

Ratchet takes a different approach. It scores your TypeScript/JavaScript codebase across 6 dimensions (testing, security, type safety, etc.), finds the highest-impact fix, applies it, runs your tests, and only commits if everything passes. Failed changes are automatically reverted.

The key command: `ratchet torque --clicks 7` runs 7 iterations of this loop. Each click must improve the score and pass tests, or it gets rolled back.

Built in 10 days, 1,627 tests. I dogfooded it on itself and improved from 72 → 86. It's TS/JS only for now, and you'll need your own API key (BYOK - your code goes to your provider, not mine).

Free tier gives unlimited scans + quick-fixes. Pro ($35/mo) adds the torque loop, GitHub Action, and a badge.

Would love feedback from the HN community. What would make this more useful for your workflow?

Site: https://ratchetcli.com
npm: ratchet-run

---

## 2. Reddit r/typescript Post

**Title:** I built Ratchet: an AI CLI that scores and improves TypeScript codebases (without breaking them)

**Body:**
Hey r/typescript,

After getting burned one too many times by AI tools that "improved" my code only to break the build, I built something different.

Ratchet scores your entire codebase across 6 dimensions (Testing, Security, Type Safety, Error Handling, Performance, Code Quality), then finds and applies the highest-impact improvements. The catch? Every change must pass your existing tests or it gets automatically reverted.

Here's what it looks like in action:

```
$ ratchet torque --clicks 7

🔍 Scanning codebase...
📊 Current score: 72/100

Click 1: Fixed 3 unsafe type assertions → Score: 76
✅ Tests passed

Click 2: Added null checks to 5 functions → Score: 79
✅ Tests passed

Click 3: Optimized 2 array operations → Score: 82
✅ Tests passed

...4 more iterations...

🏁 Final score: 86/100 (+14 points)
✅ All changes committed
```

The "Pawl" (anti-rollback mechanism) ensures that during a torque run, every change either improves your score or gets reverted. No bad commits land.

I built this in 10 days with 1,627 tests, then used it to improve itself from 72 → 86. It's still young and only supports TS/JS for now.

Free tier gets you unlimited scans and quick-fixes. Pro adds the full torque loop, GitHub integration, and a fancy badge.

Would love to hear what you think. What would make this more valuable for your TypeScript projects?

Check it out: https://ratchetcli.com
Install: npm install -g ratchet-run

---

## 3. Twitter/X Thread

**Tweet 1:**
I was tired of AI coding tools that break working code.

So I built Ratchet: an AI CLI that only commits improvements if they pass your tests.

🧵 Thread (5 min read)

---

**Tweet 2:**
The Problem:
- AI suggests a "fix"
- You apply it
- Tests fail
- You debug what wasn't broken
- 30 minutes gone

Sound familiar?

---

**Tweet 3:**
The Solution:
Ratchet scores your codebase (6 dimensions), finds the highest-impact fix, applies it, runs tests, and ONLY commits if everything passes.

Failed changes? Automatically reverted.

During a torque run, your score can only go up. 📈

---

**Tweet 4:**
How it works:
```
$ ratchet torque --clicks 7
→ Scan codebase
→ Find fix
→ Apply change
→ Run tests
→ Commit if passing
→ Repeat 7x
```

Each "click" must improve your score AND pass tests.

---

**Tweet 5:**
Built in 10 days
1,627 tests
Dogfooded on itself: 72 → 86

It's young, TS/JS only, and needs your own API key (BYOK - your code stays yours).

---

**Tweet 6:**
Free: unlimited scans + quick-fix
Pro: $35/mo for torque loop + GitHub Action + badge

Try it: npm install -g ratchet-run

Would you use this? What would you change?

---

**Tweet 7:**
Thanks for reading!

🔗 https://ratchetcli.com
📦 npm install -g ratchet-run

RTs appreciated - helps me know if I'm solving a real problem. 🙏