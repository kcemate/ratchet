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
    
    # Check 5: Potential security issues - assert statements
    for node in ast.walk(tree):
        if isinstance(node, ast.Assert):
            issues.append({
                "file": filepath,
                "line": node.lineno,
                "category": "security",
                "severity": "medium",
                "description": f"Use of assert statement at line {node.lineno} - asserts can be removed in optimized mode and should not be used for error handling",
                "suggested_fix": "Replace with proper error handling using exceptions",
                "confidence": "medium"
            })
    
    # Check 6: Potential performance issues - string concatenation in loops
    for node in ast.walk(tree):
        if isinstance(node, ast.For):
            for child in ast.iter_child_nodes(node):
                if isinstance(child, ast.With):
                    continue
                if isinstance(child, ast.Try):
                    continue
                if isinstance(child, ast.Expr):
                    continue
                if isinstance(child, ast.Assign) and isinstance(child.targets[0], ast.Name):
                    if any(isinstance(elt, ast.Str) for elt in child.value.elts):
                        # Could be string concatenation
                        pass
    
    # Check 7: Potential performance issues - list comprehensions instead of generator expressions
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == 'list':
                if node.args and isinstance(node.args[0], ast.GeneratorExp):
                    issues.append({
                        "file": filepath,
                        "line": node.lineno,
                        "category": "performance",
                        "severity": "medium",
                        "description": f"Unnecessary list() call around generator expression at line {node.lineno}",
                        "suggested_fix": "Remove list() and use generator expression directly",
                        "confidence": "medium"
                    })
    
    # Check 8: Potential error handling issues - bare except clauses
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler):
            if not node.type:
                issues.append({
                    "file": filepath,
                    "line": node.lineno,
                    "category": "error handling",
                    "severity": "high",
                    "description": f"Bare except clause at line {node.lineno} catches all exceptions, including SystemExit and KeyboardInterrupt",
                    "suggested_fix": "Specify the exception types to catch",
                    "confidence": "high"
                })
    
    # Check 9: Potential error handling issues - catching exceptions without using them
    for node in ast.walk(tree):
        if isinstance(node, ast.Try):
            has_except = False
            for child in ast.iter_child_nodes(node):
                if isinstance(child, ast.ExceptHandler):
                    has_except = True
                    break
            if has_except:
                # Check if any exception handlers actually use the exception
                handler_uses_exception = False
                for child in ast.iter_child_nodes(node):
                    if isinstance(child, ast.ExceptHandler):
                        if child.name:
                            handler_uses_exception = True
                            break
                if not handler_uses_exception:
                    issues.append({
                        "file": filepath,
                        "line": node.lineno,
                        "category": "error handling",
                        "severity": "medium",
                        "description": f"Exception handler at line {node.lineno} does not use the caught exception",
                        "suggested_fix": "Either use the exception in the handler or remove the handler",
                        "confidence": "medium"
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
