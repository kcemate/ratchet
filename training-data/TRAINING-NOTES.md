# Ratchet Model Training — Lessons & Playbook

_Last updated: 2026-03-23_

## Purpose
Document everything we learn training local models so we can hit the ground running when we move to cloud fine-tuning (Unsloth Studio, Together AI, or HF Jobs).

---

## Model History

### v1 — Qwen3.5 0.8B (Local, MLX)
- **Base:** mlx-community/Qwen3.5-0.8B-8bit (752M params, 3.6M trainable = 0.479%)
- **Training:** 1000 iters, batch 1, LR 5e-5, 8 LoRA layers, max_seq_length 512
- **Data:** 2,294 examples (273 original + 1,644 augmented + 650 autoresearch loops)
- **Loss:** Val 1.994 → 0.147 (93% drop)
- **Hardware:** Mac mini M4, 16GB RAM, peak 7GB
- **Time:** ~33 min for 1000 iters
- **Speed:** 0.5 it/sec, ~205 tokens/sec

### v2 — Autoresearch Iteration 1 (Complete)
- **Change:** +321 targeted examples (route-decomposition + N+1 queries)
- **Data:** 2,385 total (2,064 + 321 targeted)
- **LR:** 3e-5 (lower to avoid catastrophic forgetting)
- **Val loss:** 0.168 (v1 was 0.147)
- **Results:** Overall 79.8% → 81.0% (+1.2%). N+1 72.2% → 78.5% (+6.3%). Route-decomp 49.6% → 51.9% (+2.3%).
- **Takeaway:** N+1 responded well to more data. Route-decomp barely moved — likely needs larger model or semantic eval improvements, not just more examples of the same pattern.

---

## Dataset

### Category Breakdown (v1)
| Category | Count | v1 Eval Score |
|---|---|---|
| console-to-structured-logging | 414 | 94.5% ✅ |
| empty-catch-to-structured-error | 366 | 89.6% ✅ |
| mixed-torque-fixes | 330 | 84.9% ✅ |
| n-plus-one-query-fix | 264 | 72.2% ⚠️ |
| route-decomposition | 210 | 49.6% ❌ |
| autoresearch loops | 650 | (not separately scored) |
| **Total** | **2,294** | **79.8%** |

### Key Insight: Data Volume ↔ Accuracy
Direct correlation between example count and eval score:
- 414 examples → 94.5% (console-to-logging)
- 366 examples → 89.6% (empty-catch)  
- 264 examples → 72.2% (N+1)
- 210 examples → 49.6% (route-decomp)

**Rule of thumb:** Need 350+ examples per category for >85% accuracy on 0.8B model. Cloud models (7B+) should need fewer.

### Data Format
- ChatML JSONL: `{"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}`
- System prompt: Ratchet Engine persona with iterative loop instructions
- User: "Fix this code" + code block
- Assistant: Structured response with explanation + before/after code blocks

### Augmentation Strategy
- 6x augmentation from 273 originals → 1,644 (variable names, function names, context, file paths)
- Autoresearch loops: 500 single-iteration + 150 multi-iteration chain examples
- **What worked:** Varying entity names, frameworks, file paths
- **What didn't:** Exact duplicate patterns with minor whitespace changes (model memorizes instead of generalizing)

---

## Training Configuration

### What Works (MLX/Local)
```
--batch-size 1           # RAM constrained at 16GB
--learning-rate 5e-5     # Good for initial training
--learning-rate 3e-5     # Better for subsequent iterations (avoid forgetting)
--num-layers 8           # Sweet spot for 0.8B — 16 layers was too slow
--max-seq-length 512     # Truncates ~10% of examples, acceptable tradeoff
--steps-per-eval 200     # Enough granularity without slowing training
--save-every 200         # Checkpoint safety net
--seed 42                # Reproducibility
```

### What Doesn't Work
- `--config` YAML file with `--train` flag → silent early exit (bug in mlx-lm)
- `--grad-checkpoint` on 0.8B → 10x slower, no RAM benefit (model already fits)
- `--num-layers 16` → dramatically slower, marginal quality gain on 0.8B
- Qwen3.5-9B / 4B → OOM on 16GB Mac mini (swap death, 30+ min stuck on iter 1)
- `--max-seq-length 1024`+ → OOM risk, diminishing returns for fix patterns

### Cloud Training Config (Planned)
When we move to cloud (7B+ model), adjust:
```
--batch-size 4-8         # GPU has more VRAM
--learning-rate 2e-5     # Larger model = lower LR
--num-layers 16-24       # Can afford more layers
--max-seq-length 1024    # Capture full route handlers
--epochs 3-5             # Instead of fixed iters
```

---

## Conversion & Serving

### MLX → Ollama (BLOCKED)
- Qwen3.5 has `embed_tokens.biases` tensor → llama.cpp converter crashes
- Ollama `FROM /path/to/safetensors` → "unknown data type: U32" on 8-bit weights
- Float16 version also fails with U32 error
- **Status:** Waiting for llama.cpp/Ollama to add Qwen3.5 support

### MLX Server (WORKING)
```bash
python3 -m mlx_lm.server --model training-data/ratchet-fix-fused --port 8899
```
- OpenAI-compatible API at localhost:8899/v1/
- ~115 tokens/sec generation, 0.9GB RAM
- Works as drop-in replacement for any OpenAI client

### Cloud Deployment Path
1. Upload fused safetensors to HuggingFace
2. Convert with HF-native GGUF converter (better Qwen3.5 support than llama.cpp)
3. Or: serve directly via vLLM/TGI on HF Inference Endpoints

---

## Eval Harness

### Scoring Method (v1)
- `has_code_block` (15%): Does output contain markdown code blocks?
- `pattern_match` (35%): Key identifiers from expected output appear in generated
- `addresses_issue` (30%): Fix targets the correct issue type
- `no_hallucination` (10%): No made-up version numbers, fake citations
- `length_ratio` (10%): Output length reasonable vs expected

### Known Limitations
- Pattern matching is keyword-based, not semantic — misses valid alternative approaches
- 0.8B model sometimes gives correct fix but wrong explanation (explanation quality not scored)
- Max tokens 500 truncates longer route-decomposition responses → artificial failure

### Improvements for Cloud Eval
- Use a judge model (Claude/GPT-4) for semantic scoring instead of regex
- Score code compilability (run tsc on generated code)
- Score actual fix correctness (does applying the diff fix the scanner finding?)

---

## Key Decisions

1. **0.8B for local, 7B+ for cloud** — 0.8B is the largest that trains on 16GB Mac mini. Good enough for pattern fixes. Cloud model should be 7B-14B for reasoning quality.
2. **Fix patterns only, not reasoning** — Don't try to make 0.8B explain why. Just produce correct patches.
3. **Autoresearch loop in training data** — Teaching the model the full analyze→fix→evaluate loop, not just input→output pairs.
4. **Category-balanced data** — Match example counts to target accuracy. Under-represented categories fail.

---

## Cloud Training Checklist (When Ready)
- [ ] Choose base model (Qwen3.5 7B? Llama 4? Codestral?)
- [ ] Upload dataset to HuggingFace (train/valid/test splits)
- [ ] Choose platform (HF Jobs + TRL, Unsloth Studio, Together AI)
- [ ] Set budget ($10-50 for first run on T4/A10G)
- [ ] Run training with Trackio monitoring
- [ ] Eval with judge model
- [ ] Convert to GGUF Q4_K_M for Ollama distribution
- [ ] A/B test: local 0.8B vs cloud 7B on real ratchet torque runs
- [ ] Ship as `ratchet torque --local` (0.8B) and `ratchet torque --local-hq` (7B)
