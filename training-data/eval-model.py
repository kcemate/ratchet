#!/usr/bin/env python3
"""
Ratchet Model Eval Harness — Autoresearch Click 1
Runs test.jsonl through the fine-tuned model and scores outputs.
"""
import json
import re
import sys
import time
import urllib.request

MODEL = "/Users/giovanni/Projects/ratchet/training-data/ratchet-fix-fused"
API_URL = "http://localhost:8899/v1/chat/completions"
TEST_FILE = "training-data/mlx-split/test.jsonl"
RESULTS_FILE = "training-data/eval-results.json"
MAX_TOKENS = 500
TEMPERATURE = 0.3

def classify_example(messages):
    """Classify example by category based on content."""
    user_msg = next((m["content"] for m in messages if m["role"] == "user"), "")
    assistant_msg = next((m["content"] for m in messages if m["role"] == "assistant"), "")
    combined = (user_msg + " " + assistant_msg).lower()
    
    if "console." in combined and ("pino" in combined or "logger" in combined or "structured log" in combined):
        return "console-to-logging"
    elif "catch" in combined and ("empty" in combined or "catch (e) {}" in combined or "catch {}" in combined):
        return "empty-catch"
    elif "n+1" in combined or "n-plus" in combined or "batch" in combined and "query" in combined:
        return "n-plus-one"
    elif "route" in combined and ("decompos" in combined or "split" in combined or "extract" in combined):
        return "route-decomposition"
    elif "iteration" in combined or "ratchet improvement" in combined:
        return "autoresearch-loop"
    else:
        return "mixed"

def score_output(generated, expected):
    """Score model output vs expected. Returns dict of scores."""
    scores = {}
    
    # 1. Contains code block?
    has_code = bool(re.search(r'```\w*\n', generated))
    scores["has_code_block"] = 1.0 if has_code else 0.0
    
    # 2. Code structural similarity (extract code blocks, compare key patterns)
    gen_code = extract_code_blocks(generated)
    exp_code = extract_code_blocks(expected)
    
    if exp_code:
        # Check key patterns from expected appear in generated
        exp_patterns = extract_key_patterns(exp_code)
        gen_patterns = extract_key_patterns(gen_code)
        if exp_patterns:
            overlap = len(exp_patterns & gen_patterns) / len(exp_patterns)
            scores["pattern_match"] = round(overlap, 2)
        else:
            scores["pattern_match"] = 0.5  # neutral
    else:
        scores["pattern_match"] = 0.5
    
    # 3. Fix category accuracy (does it address the right issue?)
    scores["addresses_issue"] = 1.0 if check_addresses_issue(generated, expected) else 0.0
    
    # 4. No hallucination check (doesn't invent file paths, imports that aren't in the prompt)
    scores["no_hallucination"] = 1.0 if not detect_hallucination(generated) else 0.0
    
    # 5. Reasonable length (not too short, not too verbose)
    gen_len = len(generated)
    exp_len = len(expected)
    ratio = gen_len / max(exp_len, 1)
    scores["length_ratio"] = 1.0 if 0.3 <= ratio <= 3.0 else 0.5 if 0.1 <= ratio <= 5.0 else 0.0
    
    # Overall score (weighted)
    scores["overall"] = round(
        scores["has_code_block"] * 0.15 +
        scores["pattern_match"] * 0.35 +
        scores["addresses_issue"] * 0.30 +
        scores["no_hallucination"] * 0.10 +
        scores["length_ratio"] * 0.10,
        3
    )
    
    return scores

def extract_code_blocks(text):
    """Extract all code from markdown code blocks."""
    blocks = re.findall(r'```\w*\n(.*?)```', text, re.DOTALL)
    return "\n".join(blocks)

def extract_key_patterns(code):
    """Extract key identifiers and patterns from code."""
    patterns = set()
    # Function/method calls
    for m in re.finditer(r'(\w+)\s*\(', code):
        patterns.add(m.group(1))
    # Import names
    for m in re.finditer(r'(?:import|require)\s*.*?[\'"]([^\'"]+)[\'"]', code):
        patterns.add(m.group(1))
    # Key TypeScript patterns
    for kw in ['catch', 'try', 'async', 'await', 'logger', 'pino', 'error', 'throw', 'Map', 'Set', 'Promise']:
        if kw in code:
            patterns.add(kw)
    return patterns

def check_addresses_issue(generated, expected):
    """Check if generated output addresses the same issue type."""
    exp_lower = expected.lower()
    gen_lower = generated.lower()
    
    issue_markers = [
        ("empty catch", ["catch", "error", "handle"]),
        ("console.", ["logger", "pino", "log"]),
        ("n+1", ["batch", "map", "set", "any($"]),
        ("route", ["extract", "split", "handler"]),
    ]
    
    for marker, fixes in issue_markers:
        if marker in exp_lower:
            return any(f in gen_lower for f in fixes)
    
    # Default: check if it at least has code
    return bool(re.search(r'```', generated))

def detect_hallucination(text):
    """Basic hallucination detection."""
    # Check for suspiciously specific invented details
    red_flags = [
        r'version \d+\.\d+\.\d+ of',  # Made up version numbers
        r'according to the docs',  # Citing non-existent docs
        r'as of 202[0-9]',  # Made up dates
    ]
    for flag in red_flags:
        if re.search(flag, text, re.IGNORECASE):
            return True
    return False

def query_model(messages):
    """Query the MLX server."""
    payload = json.dumps({
        "model": MODEL,
        "messages": messages[:2],  # system + user only (not the expected assistant response)
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
    }).encode()
    
    req = urllib.request.Request(API_URL, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"ERROR: {e}"

def main():
    print("🔧 Ratchet Model Eval Harness")
    print(f"   Model: {MODEL}")
    print(f"   Test file: {TEST_FILE}")
    print()
    
    with open(TEST_FILE) as f:
        examples = [json.loads(line) for line in f if line.strip()]
    
    print(f"📊 {len(examples)} test examples loaded")
    print()
    
    results = []
    category_scores = {}
    
    for i, ex in enumerate(examples):
        messages = ex["messages"]
        category = classify_example(messages)
        expected = next((m["content"] for m in messages if m["role"] == "assistant"), "")
        
        # Query model
        start = time.time()
        generated = query_model(messages)
        elapsed = time.time() - start
        
        if generated.startswith("ERROR:"):
            print(f"  [{i+1}/{len(examples)}] ❌ {category}: {generated}")
            scores = {"overall": 0, "error": generated}
        else:
            scores = score_output(generated, expected)
            print(f"  [{i+1}/{len(examples)}] {'✅' if scores['overall'] >= 0.5 else '⚠️'} {category}: {scores['overall']:.2f} ({elapsed:.1f}s)")
        
        # Track per-category
        if category not in category_scores:
            category_scores[category] = []
        category_scores[category].append(scores.get("overall", 0))
        
        results.append({
            "index": i,
            "category": category,
            "scores": scores,
            "elapsed": round(elapsed, 2),
            "generated_preview": generated[:300] if not generated.startswith("ERROR") else generated,
        })
    
    # Summary
    print("\n" + "="*60)
    print("📈 CATEGORY SCORES")
    print("="*60)
    
    summary = {}
    for cat, cat_scores in sorted(category_scores.items()):
        avg = sum(cat_scores) / len(cat_scores)
        passing = sum(1 for s in cat_scores if s >= 0.5)
        summary[cat] = {"avg": round(avg, 3), "count": len(cat_scores), "passing": passing}
        bar = "█" * int(avg * 20) + "░" * (20 - int(avg * 20))
        print(f"  {cat:25s} {bar} {avg:.1%} ({passing}/{len(cat_scores)} passing)")
    
    overall_avg = sum(r["scores"].get("overall", 0) for r in results) / len(results)
    overall_passing = sum(1 for r in results if r["scores"].get("overall", 0) >= 0.5)
    print(f"\n  {'OVERALL':25s} {'█' * int(overall_avg * 20)}{'░' * (20 - int(overall_avg * 20))} {overall_avg:.1%} ({overall_passing}/{len(results)} passing)")
    
    # Save results
    output = {
        "model": MODEL,
        "test_file": TEST_FILE,
        "num_examples": len(examples),
        "overall_score": round(overall_avg, 3),
        "overall_passing": overall_passing,
        "category_summary": summary,
        "results": results,
    }
    
    with open(RESULTS_FILE, "w") as f:
        json.dump(output, f, indent=2)
    
    print(f"\n💾 Full results saved to {RESULTS_FILE}")
    
    # Identify weakest categories for next iteration
    weakest = sorted(summary.items(), key=lambda x: x[1]["avg"])[:3]
    print(f"\n🎯 WEAKEST CATEGORIES (target for Click 2):")
    for cat, stats in weakest:
        print(f"   - {cat}: {stats['avg']:.1%} ({stats['passing']}/{stats['count']})")

if __name__ == "__main__":
    main()
