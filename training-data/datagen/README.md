# Data Quality Linter Framework

## Overview

This linter validates scan JSON files produced by the datagen scanners before they enter the knowledge base pipeline. It uses Gemma 4 via Ollama to spot-check issues for plausibility.

## Prerequisites

1. **Ollama** installed and running
2. **Gemma 4** model pulled: `ollama pull gemma4:e4b`

## Usage

```bash
cd ~/Projects/Ratchet/training-data/datagen
./lint-script.sh [file1.json] [file2.json] ...
```

Or run without arguments to lint all JSON files:
```bash
./lint-script.sh
```

## Linter Logic

The linter evaluates files based on three criteria:

1. **Structure** (30%): Valid JSON, correct top-level format (array of objects)
2. **Content** (50%): Quality of descriptions, diversity of suggested fixes
3. **Gemma Plausibility** (20%): AI evaluation of issue authenticity

### Scoring

- **PASS** (≥80%): Ready for pipeline
- **WARN** (50-80%): Needs structural fixes or content review
- **FAIL** (<50%): Quarantined - content quality too low

## Lint Log

Results are appended to `~/Projects/Ratchet/knowledge/lint-log.md` with detailed analysis.

## Quarantine

Failed files are moved to `~/Projects/Ratchet/training-data/datagen/quarantine/` to be skipped by the wiki/QA generators.

## Validation Rules

Each issue object must contain:
- `file`: string
- `line`: number
- `category`: string
- `severity`: string
- `description`: string (>30 chars recommended)
- `suggested_fix`: string (specific to the issue)
- `confidence`: number (0-100)

## Examples

### Good file (PASS)
- `trekhleb-javascript-algorithms.json` - rich descriptions, specific fixes

### Needs work (WARN)
- `facebook-react-*.json` - object structure `{file, issues:[]}` needs conversion to array

### Bad file (FAIL)
- `vuejs-core.json` - template outputs, short descriptions, low diversity
