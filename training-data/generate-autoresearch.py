#!/usr/bin/env python3
"""
Generate autoresearch/ratchet-loop training examples.
Teaches the model to think in iterations:
1. ANALYZE — scan code, identify issues with scores
2. PRIORITIZE — pick highest-impact fix
3. PLAN — propose specific change
4. IMPLEMENT — write the fix
5. EVALUATE — confirm improvement
"""
import json
import random

random.seed(42)

SYSTEM_PROMPT = """You are Ratchet Engine, an iterative code quality improvement agent. You operate in a loop:

1. ANALYZE: Scan the codebase and identify issues with severity scores
2. PRIORITIZE: Select the single highest-impact fix (score gain / effort)
3. PLAN: Describe the exact change needed (files, lines, approach)
4. IMPLEMENT: Write the fixed code
5. EVALUATE: Confirm the fix resolves the issue and estimate score delta

Always pick ONE focused fix per iteration. Never change more than 3 files. Prefer fixes that improve the score the most with the least risk of regression."""

# Templates based on real ratchet patterns from our codebase
TEMPLATES = [
    # Console → Structured Logging
    {
        "category": "console-to-pino",
        "analyze_variants": [
            "Scanning {file}...\n\nIssues found:\n- [PERF-001] console.log on line {line1}: unstructured logging in production path (score: -2)\n- [PERF-002] console.error on line {line2}: no context object, loses structured data (score: -2)\n- [SEC-001] console.log on line {line3}: may leak sensitive request data (score: -3)\n\nCurrent Performance score: {score_before}/10",
            "Analysis of {file}:\n\nDetected {count} console.* calls in production code.\n- {count_log} console.log (unstructured, no levels)\n- {count_err} console.error (no error context)\nEstimated score impact: -{impact} points in Performance category.\n\nCurrent score: {score_before}/10 Performance",
        ],
        "prioritize": "Highest impact: Replace console.* with pino structured logger.\nReason: {count} calls across {files} files. Each fix is mechanical (low risk) but improves Performance score by ~{delta} points.\nROI: High impact / Low effort.",
        "plan_variants": [
            "Plan:\n1. Import pino logger from shared module: `import {{ logger }} from '../lib/logger'`\n2. Replace `console.log(msg)` → `logger.info({{ context }}, msg)`\n3. Replace `console.error(msg)` → `logger.error({{ err, context }}, msg)`\n4. Add request context where available\nFiles: {file}\nLines: {lines}\nRisk: Low — mechanical replacement, no logic change",
            "Plan:\n1. Add `import {{ logger }} from '../lib/logger'` at top of {file}\n2. Convert {count} console.* calls to structured pino equivalents\n3. Attach error objects to logger.error calls\n4. Remove any string concatenation in favor of object context\nEstimated score delta: +{delta} Performance",
        ],
        "code_before_variants": [
            'console.log("Processing request for user:", userId);\ntry {{\n  const result = await processOrder(orderId);\n  console.log("Order processed:", result.id);\n}} catch (err) {{\n  console.error("Failed to process order:", err.message);\n}}',
            'console.log(`Starting sync for ${{teamId}}`);\nconst items = await fetchItems();\nconsole.log(`Fetched ${{items.length}} items`);\nif (items.length === 0) {{\n  console.warn("No items found");\n}}',
            'console.log("Webhook received:", JSON.stringify(payload));\ntry {{\n  await handleWebhook(payload);\n}} catch (error) {{\n  console.error("Webhook failed:", error);\n  console.log("Payload was:", payload);\n}}',
        ],
        "code_after_variants": [
            'logger.info({{ userId }}, "Processing request for user");\ntry {{\n  const result = await processOrder(orderId);\n  logger.info({{ orderId: result.id }}, "Order processed");\n}} catch (err) {{\n  logger.error({{ err, orderId }}, "Failed to process order");\n}}',
            'logger.info({{ teamId }}, "Starting sync");\nconst items = await fetchItems();\nlogger.info({{ count: items.length, teamId }}, "Fetched items");\nif (items.length === 0) {{\n  logger.warn({{ teamId }}, "No items found");\n}}',
            'logger.info({{ webhookId: payload.id }}, "Webhook received");\ntry {{\n  await handleWebhook(payload);\n}} catch (err) {{\n  logger.error({{ err, webhookId: payload.id }}, "Webhook failed");\n}}',
        ],
        "evaluate": "Fix applied. Replaced {count} console.* calls with structured pino logging.\n- Added error context objects to all catch blocks\n- Removed string interpolation in log messages\n- Score delta: +{delta} Performance ({score_before} → {score_after})\n- Risk: None — no logic changes, only logging output format\n- Tests: All passing (logging is side-effect only)",
    },
    # Empty Catch → Structured Error
    {
        "category": "empty-catch-to-structured",
        "analyze_variants": [
            "Scanning {file}...\n\nIssues found:\n- [ERR-001] Empty catch block on line {line1}: silently swallows error (score: -3)\n- [ERR-002] Catch with only comment on line {line2}: no error handling (score: -2)\n\nCurrent ErrorHandling score: {score_before}/20",
            "Analysis of {file}:\n\n{count} empty or comment-only catch blocks detected.\nThese silently swallow errors, making debugging impossible in production.\nSeverity: HIGH — each empty catch is a potential silent failure.\n\nCurrent score: {score_before}/20 ErrorHandling",
        ],
        "prioritize": "Highest impact: Add structured error handling to empty catch blocks.\nReason: Silent failures are the #1 cause of production debugging nightmares. Each fix adds observability.\nROI: Critical impact / Low effort — each is 2-3 lines added.",
        "plan_variants": [
            "Plan:\n1. For each empty catch: determine if error is recoverable or fatal\n2. Recoverable: log warning + continue with fallback\n3. Fatal: log error + re-throw or return error response\n4. Always include error object in structured log\nFiles: {file}\nRisk: Low — adding handling, not changing logic",
            "Plan:\n1. Identify catch block intent from surrounding code\n2. Add `logger.error({{ err }}, 'descriptive message')` minimum\n3. For API handlers: ensure error response is sent\n4. For background tasks: log + continue with degraded state\nEstimated score delta: +{delta} ErrorHandling",
        ],
        "code_before_variants": [
            'try {{\n  await db.query("UPDATE users SET last_login = NOW() WHERE id = $1", [userId]);\n}} catch (e) {{\n  // ignore\n}}',
            'try {{\n  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));\n}} catch (err) {{\n}}',
            'try {{\n  await sendNotification(userId, message);\n}} catch (e) {{\n  // non-fatal\n}}',
        ],
        "code_after_variants": [
            'try {{\n  await db.query("UPDATE users SET last_login = NOW() WHERE id = $1", [userId]);\n}} catch (err) {{\n  logger.error({{ err, userId }}, "Failed to update last login");\n  // Non-fatal: user session continues without login timestamp\n}}',
            'try {{\n  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));\n}} catch (err) {{\n  logger.error({{ err, configPath }}, "Failed to parse config file");\n  throw new Error(`Invalid config at ${{configPath}}: ${{err.message}}`);\n}}',
            'try {{\n  await sendNotification(userId, message);\n}} catch (err) {{\n  logger.warn({{ err, userId }}, "Notification delivery failed — non-fatal, continuing");\n}}',
        ],
        "evaluate": "Fix applied. Replaced {count} empty catch blocks with structured error handling.\n- Each catch now logs with error object + context\n- Recoverable errors: warn + continue\n- Fatal errors: error + re-throw\n- Score delta: +{delta} ErrorHandling ({score_before} → {score_after})\n- No silent failures remain in {file}",
    },
    # N+1 → Batch Query
    {
        "category": "n-plus-one-to-batch",
        "analyze_variants": [
            "Scanning {file}...\n\nIssues found:\n- [PERF-003] N+1 query pattern on line {line1}: database call inside loop (score: -4)\n- Loop iterates over {count} items, generating {count} individual queries\n- Estimated latency: {count} × ~5ms = ~{latency}ms vs ~5ms batched\n\nCurrent Performance score: {score_before}/10",
            "Analysis of {file}:\n\nN+1 query detected: `{query}` called inside for/map/forEach loop.\n{count} iterations = {count} round trips to database.\nThis is the #1 performance anti-pattern in Node.js backends.\n\nCurrent score: {score_before}/10 Performance",
        ],
        "prioritize": "Highest impact: Convert N+1 loop query to single batch query.\nReason: Eliminates ~{latency}ms latency per request. Single biggest perf win available.\nROI: Critical impact / Medium effort — requires SQL IN clause or batch API.",
        "plan_variants": [
            "Plan:\n1. Collect all IDs/keys before the loop\n2. Execute single batch query: `WHERE id = ANY($1)` or `WHERE id IN (...)`\n3. Build lookup map from results\n4. Replace loop body to read from map instead of querying\nFiles: {file}\nRisk: Medium — must verify result ordering matches expectations",
        ],
        "code_before_variants": [
            'const enrichedItems = [];\nfor (const item of items) {{\n  const user = await db.query("SELECT name, avatar FROM users WHERE id = $1", [item.userId]);\n  enrichedItems.push({{ ...item, user: user.rows[0] }});\n}}',
            'const results = await Promise.all(\n  groupIds.map(async (id) => {{\n    const members = await db.query("SELECT * FROM members WHERE group_id = $1", [id]);\n    return {{ groupId: id, members: members.rows }};\n  }})\n);',
        ],
        "code_after_variants": [
            'const userIds = [...new Set(items.map(i => i.userId))];\nconst users = await db.query("SELECT id, name, avatar FROM users WHERE id = ANY($1)", [userIds]);\nconst userMap = new Map(users.rows.map(u => [u.id, u]));\nconst enrichedItems = items.map(item => ({{ ...item, user: userMap.get(item.userId) }}));',
            'const members = await db.query("SELECT * FROM members WHERE group_id = ANY($1)", [groupIds]);\nconst memberMap = new Map();\nfor (const m of members.rows) {{\n  if (!memberMap.has(m.group_id)) memberMap.set(m.group_id, []);\n  memberMap.get(m.group_id).push(m);\n}}\nconst results = groupIds.map(id => ({{ groupId: id, members: memberMap.get(id) || [] }}));',
        ],
        "evaluate": "Fix applied. Converted N+1 query loop to single batch query.\n- Before: {count} queries (~{latency}ms)\n- After: 1 query (~5ms)\n- Speedup: ~{speedup}x\n- Score delta: +{delta} Performance ({score_before} → {score_after})\n- Tests: Passing — verified result ordering matches original",
    },
    # Route Decomposition
    {
        "category": "route-decomposition",
        "analyze_variants": [
            "Scanning {file}...\n\nIssues found:\n- [QUAL-001] Function on line {line1} is {lines_long} lines (threshold: 50) (score: -2)\n- [QUAL-002] Route handler mixes validation, business logic, and response formatting (score: -2)\n\nCurrent CodeQuality score: {score_before}/15",
        ],
        "prioritize": "Highest impact: Decompose oversized route handler into focused functions.\nReason: {lines_long}-line handler is untestable as a unit. Extracting logic enables independent testing.\nROI: High impact / Medium effort — extract, don't rewrite.",
        "plan_variants": [
            "Plan:\n1. Extract validation logic into a dedicated validate function\n2. Extract business logic into a dedicated handler function\n3. Route handler becomes: validate → execute → respond\n4. Each extracted function gets its own test\nFiles: {file}\nRisk: Low — pure extraction, no behavior change",
        ],
        "code_before_variants": [
            'app.post("/api/deuces", async (req, res) => {{\n  const {{ note, location, rating, groupId }} = req.body;\n  if (!note || note.length > 500) return res.status(400).json({{ error: "Invalid note" }});\n  if (rating && (rating < 1 || rating > 5)) return res.status(400).json({{ error: "Invalid rating" }});\n  const userId = req.user.id;\n  const today = new Date().toISOString().split("T")[0];\n  const count = await db.query("SELECT COUNT(*) FROM deuces WHERE user_id = $1 AND DATE(created_at) = $2", [userId, today]);\n  if (count.rows[0].count >= 20) return res.status(429).json({{ error: "Daily limit reached" }});\n  const result = await db.query("INSERT INTO deuces (user_id, note, location, rating, group_id) VALUES ($1,$2,$3,$4,$5) RETURNING *", [userId, note, location, rating, groupId]);\n  await recalculateStreak(userId);\n  res.status(201).json(result.rows[0]);\n}});',
        ],
        "code_after_variants": [
            'function validateDeuce(body: unknown): {{ note: string; location?: string; rating?: number; groupId?: string }} {{\n  const {{ note, location, rating, groupId }} = body as Record<string, unknown>;\n  if (!note || typeof note !== "string" || note.length > 500) throw new ValidationError("Invalid note");\n  if (rating != null && (typeof rating !== "number" || rating < 1 || rating > 5)) throw new ValidationError("Invalid rating");\n  return {{ note, location: location as string, rating: rating as number, groupId: groupId as string }};\n}}\n\nasync function createDeuce(userId: string, data: ReturnType<typeof validateDeuce>) {{\n  const today = new Date().toISOString().split("T")[0];\n  const count = await db.query("SELECT COUNT(*) FROM deuces WHERE user_id = $1 AND DATE(created_at) = $2", [userId, today]);\n  if (Number(count.rows[0].count) >= 20) throw new RateLimitError("Daily limit reached");\n  const result = await db.query("INSERT INTO deuces (user_id, note, location, rating, group_id) VALUES ($1,$2,$3,$4,$5) RETURNING *", [userId, data.note, data.location, data.rating, data.groupId]);\n  await recalculateStreak(userId);\n  return result.rows[0];\n}}\n\napp.post("/api/deuces", asyncRoute(async (req, res) => {{\n  const data = validateDeuce(req.body);\n  const deuce = await createDeuce(req.user.id, data);\n  res.status(201).json(deuce);\n}}));',
        ],
        "evaluate": "Fix applied. Decomposed {lines_long}-line route handler into 3 focused functions.\n- validateDeuce(): input validation (testable independently)\n- createDeuce(): business logic (testable independently)\n- Route handler: 4 lines — validate → execute → respond\n- Score delta: +{delta} CodeQuality ({score_before} → {score_after})\n- Function count below 50-line threshold: all 3 functions ✓",
    },
]

FILES = [
    "server/routes.ts", "server/routes/groups.ts", "server/routes/premium.ts",
    "server/routes/battle.ts", "server/routes/sync.ts", "server/lib/helpers.ts",
    "src/core/engine.ts", "src/core/click.ts", "src/commands/torque.ts",
    "src/commands/scan.ts", "src/server.ts", "api/src/worker.ts",
    "server/routes/analytics.ts", "server/routes/auth.ts",
]

def make_example(template, iteration=1):
    file = random.choice(FILES)
    line1 = random.randint(10, 300)
    line2 = line1 + random.randint(5, 40)
    line3 = line2 + random.randint(5, 40)
    count = random.randint(3, 15)
    score_before = random.randint(3, 7)
    delta = random.randint(1, 3)
    score_after = min(score_before + delta, 10)
    latency = count * 5
    speedup = count
    lines_long = random.randint(55, 180)

    fmt = dict(
        file=file, line1=line1, line2=line2, line3=line3,
        count=count, count_log=max(1, count-2), count_err=min(2, count),
        score_before=score_before, score_after=score_after,
        delta=delta, impact=delta+1, latency=latency, speedup=speedup,
        lines_long=lines_long, files=random.randint(1, 4),
        lines=f"{line1}, {line2}, {line3}",
        query="db.query(...)", entity="Deuce", action="create",
    )

    analyze = random.choice(template["analyze_variants"]).format(**fmt)
    prioritize = template["prioritize"].format(**fmt)
    plan = random.choice(template["plan_variants"]).format(**fmt)

    code_idx = random.randint(0, len(template["code_before_variants"]) - 1)
    code_before = template["code_before_variants"][code_idx].format(**fmt)
    code_after = template["code_after_variants"][min(code_idx, len(template["code_after_variants"])-1)].format(**fmt)
    evaluate = template["evaluate"].format(**fmt)

    # Full autoresearch loop as assistant response
    assistant_response = f"""## Iteration {iteration}

### ANALYZE
{analyze}

### PRIORITIZE
{prioritize}

### PLAN
{plan}

### IMPLEMENT

**Before:**
```typescript
{code_before}
```

**After:**
```typescript
{code_after}
```

### EVALUATE
{evaluate}"""

    user_prompt = f"Run one ratchet improvement iteration on `{file}`. Current score: {score_before}. Focus on the highest-impact fix."

    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
            {"role": "assistant", "content": assistant_response},
        ]
    }


# Generate examples
examples = []
for _ in range(500):
    template = random.choice(TEMPLATES)
    iteration = random.randint(1, 7)
    examples.append(make_example(template, iteration))

# Also generate multi-iteration chains (2-3 iterations in one response)
for _ in range(150):
    templates_picked = random.sample(TEMPLATES, k=min(2, len(TEMPLATES)))
    file = random.choice(FILES)
    score = random.randint(3, 6)

    full_response = ""
    for i, t in enumerate(templates_picked, 1):
        ex = make_example(t, i)
        # Extract just the assistant content after "## Iteration"
        full_response += ex["messages"][2]["content"] + "\n\n"
        score += random.randint(1, 2)

    examples.append({
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Run a ratchet improvement session on `{file}`. Current score: {score - 4}. Complete 2 iterations, picking the highest-impact fix each time."},
            {"role": "assistant", "content": full_response.strip()},
        ]
    })

random.shuffle(examples)

output_path = "training-data/ratchet-autoresearch.jsonl"
with open(output_path, "w") as f:
    for ex in examples:
        f.write(json.dumps(ex) + "\n")

print(f"Generated {len(examples)} autoresearch training examples")
print(f"  - {500} single-iteration examples")
print(f"  - {150} multi-iteration chain examples")
print(f"Saved to {output_path}")
