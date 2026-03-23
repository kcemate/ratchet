# Ratchet Fix Training Data v1
Generated: 2026-03-23T18:27:51.309Z

## Stats
- Total pairs: 274
- Source repos: ratchet, DeuceDiary
- Format: ChatML JSONL (OpenAI/Unsloth compatible)

## Categories
- console-to-structured-logging: 69 pairs
- empty-catch-to-structured-error: 61 pairs
- mixed-torque-fixes: 55 pairs
- n-plus-one-query-fix: 44 pairs
- route-decomposition: 35 pairs
- mixed-sweep-fixes: 6 pairs
- bare-fetch-to-auth-request: 2 pairs
- auth-rate-limiting: 1 pairs
- auth-integration-fix: 1 pairs

## Source Commits
- Ratchet: 98205fb, 9e600e8, b188e98, 15249d0, cb297f6
- DeuceDiary: 3b90e02f, d4673ce2, f20c7e64, ef2d7631, 70bedc60, 0f5f8513, 7fa3eb88, 73078970, 589cda32, 7a9249fe, 1162da95

## Usage
```bash
# With Unsloth Studio
# 1. Load ratchet-fix-v1.jsonl as training data
# 2. Base model: Qwen 3.5 7B or Llama 4 Scout 8B
# 3. LoRA rank 16, epochs 3-5, lr 2e-4
# 4. Export to GGUF Q4_K_M for Ollama
```
