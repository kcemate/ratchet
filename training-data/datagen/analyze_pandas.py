#!/usr/bin/env python3
import ast
import os
import re
from pathlib import Path

def analyze_file(filepath):
    """Analyze a single Python file for issues."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    tree = ast.parse(content)
    lines = content.split('\n')
    issues = []
    
    # Check 1: File length
    if len(lines) > 1500:
        issues.append({
            "file": filepath,
            "line": 1,
            "category": "code quality",
            "severity": "high",
            "description": f"File {filepath} is over 1500 lines long, indicating a god file that violates single responsibility principle",
            "suggested_fix": "Break down into smaller, focused modules",
            "confidence": "medium"
        })
    
    # Check 2: TODO/FIXME comments
    for i, line in enumerate(lines, 1):
        if re.search(r'TODO|FIXME|XXX', line, re.IGNORECASE):
            issues.append({
                "file": filepath,
                "line": i,
                "category": "code quality",
                "severity": "low",
                "description": f"TODO/FIXME comment found at line {i}",
                "suggested_fix": "Address or remove the comment",
                "confidence": "low"
            })
    
    # Check 3: Large functions
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            start_line = node.lineno
            end_line = node.end_lineno
            if end_line - start_line > 50:
                issues.append({
                    "file": filepath,
                    "line": start_line,
                    "category": "code quality",
                    "severity": "medium",
                    "description": f"Function '{node.name}' spans {end_line-start_line} lines, which is too long for a single function",
                    "suggested_fix": "Break the function into smaller, more manageable pieces",
                    "confidence": "medium"
                })
    
    # Check 4: Potential security issues - eval/exec usage
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in ['eval', 'exec', 'execfile']:
                    issues.append({
                        "file": filepath,
                        "line": node.lineno,
                        "category": "security",
                        "severity": "high",
                        "description": f"Use of dangerous {node.func.id} function at line {node.lineno}",
                        "suggested_fix": "Replace with safer alternatives like ast.literal_eval",
                        "confidence": "high"
                    })
    
    return issues

def main():
    base_dir = "/Users/giovanni/Projects/ratchet/training-data/datagen/pandas"
    files_to_analyze = [
        "pandas/core/frame.py",
        "pandas/core/series.py",
        "pandas/core/indexes/base.py",
        "pandas/core/reshape/merge.py",
        "pandas/core/dtypes/missing.py",
        "pandas/core/internals.py",
        "pandas/core/array.py",
        "pandas/core/groupby/groupby.py",
        "pandas/core/ops.py",
        "pandas/core/indexing.py"
    ]
    
    all_issues = []
    
    for rel_path in files_to_analyze:
        filepath = os.path.join(base_dir, rel_path)
        if os.path.exists(filepath):
            print(f"Analyzing {rel_path}...")
            issues = analyze_file(filepath)
            all_issues.extend(issues)
            print(f"  Found {len(issues)} issues")
        else:
            print(f"File not found: {rel_path}")
    
    output_file = "/Users/giovanni/Projects/ratchet/training-data/datagen/pandas-dev-pandas.json"
    import json
    with open(output_file, 'w') as f:
        json.dump(all_issues, f, indent=2)
    
    print(f"\nTotal issues found: {len(all_issues)}")
    print(f"Results saved to: {output_file}")

if __name__ == "__main__":
    main()
