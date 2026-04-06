#!/usr/bin/env python3
"""
Generate wiki article for a Ratchet scan
Usage: ./generate_wiki_article.py <scan_file.json>
"""

import json
import os
import subprocess
import sys
from pathlib import Path

def main():
    if len(sys.argv) != 2:
        print("Usage: ./generate_wiki_article.py <scan_file.json>")
        sys.exit(1)
    
    scan_file = Path(sys.argv[1])
    if not scan_file.exists():
        print(f"Error: Scan file {scan_file} not found")
        sys.exit(1)
    
    # Read scan data
    try:
        scan_data = json.loads(scan_file.read_text())
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON in {scan_file}")
        sys.exit(1)
    
    # Extract repo info
    filename = scan_file.stem
    parts = filename.split('-', 1)
    repo_owner = parts[0]
    repo_name = parts[1] if len(parts) > 1 else repo_owner
    
    # Build the prompt
    prompt = f"""You are an expert code analysis writer and quality assessor. Transform the raw scan JSON data below into a comprehensive, actionable wiki article.

SCAN_DATA: {json.dumps(scan_data)}

ARTICLE REQUIREMENTS:
- Depth over breadth: Provide thorough analysis of significant issues
- Concrete examples: Include specific code snippets from the scan
- Actionable guidance: Every problem must have clear, implementable solutions
- Structured clarity: Organize for easy scanning and reference

ARTICLE STRUCTURE:
- Title: {repo_owner}-{repo_name}
- Summary: 2-3 sentences about what the repo does, primary language, and rough size/complexity
- Issues Found: 3-5 significant, substantive issues (not minor nitpicks)
  - Each issue: clear description + specific code context + impact explanation
  - Use actual code snippets (not paraphrased)
- Patterns: 2-3 overarching anti-patterns across the issues
  - Show how different issues reflect the same underlying problem
- Fix Guide: Specific, step-by-step remediation instructions
  - Include before/after code examples
  - Explain why the fix works
- Severity Assessment: Well-reasoned opinion on production readiness
  - Consider issue severity, prevalence, and fix complexity

WRITING STYLE:
- Professional but accessible tone
- Use markdown formatting for scannability
- Include summary tables for quick reference
- Use emojis sparingly for emphasis
- Keep explanations concise but thorough

OUTPUT FORMAT:
```markdown
Code Analysis Summary Report

File: {scan_file}
Primary Focus: primary_focus_areas

opening_summary

---

Analysis by Theme

Theme 1 Name (Severity: level, Confidence: level)
detailed_analysis_with_code_examples

Theme 2 Name (Severity: level, Confidence: level)
detailed_analysis_with_code_examples

...

Remediation Strategy (Action Plan)

Priority 1: Most_critical_fix
description

Priority 2: Important_fix
description

Priority 3: Nice_to_have
description

---

Summary Table

Finding Category | Core Problem | Recommended Fix | Priority | Affected Components

---

Severity Assessment

Overall Production-Readiness Opinion: emoji Risk_Level
reasoning

Recommendation: action
```

Generate the comprehensive wiki article for the {repo_owner}-{repo_name} repository."""
    
    # Run ollama
    try:
        result = subprocess.run(
            ['ollama', 'run', 'gemma4:e4b'],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=300
        )
        
        if result.returncode != 0:
            print(f"Ollama error: {result.stderr}")
            sys.exit(1)
        
        output = result.stdout
        
    except subprocess.TimeoutExpired:
        print("Error: Ollama command timed out")
        sys.exit(1)
    except Exception as e:
        print(f"Error running ollama: {e}")
        sys.exit(1)
    
    # Extract markdown content
    if '```markdown' in output:
        start = output.index('```markdown') + 13
        end = output.index('```', start)
        content = output[start:end].strip()
    else:
        # Fallback: extract the analysis part
        content = output
    
    # Write to wiki file
    wiki_dir = Path.home() / 'Projects' / 'Ratchet' / 'knowledge' / 'wiki'
    wiki_dir.mkdir(parents=True, exist_ok=True)
    wiki_file = wiki_dir / f"{repo_owner}-{repo_name}.md"
    wiki_file.write_text(content)
    
    print(f"✅ Successfully generated wiki article:")
    print(f"  Input:  {scan_file}")
    print(f"  Output: {wiki_file}")
    print("\nGenerated content preview:")
    print("=" * 80)
    print(content[:1000] + "..." if len(content) > 1000 else content)
    print("=" * 80)

if __name__ == '__main__':
    main()