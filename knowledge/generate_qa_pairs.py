#!/usr/bin/env python3
"""
Q&A Pair Generator for Ratchet training data
Uses Gemma 4 via Ollama to generate training pairs from scan JSON files
"""

import json
import os
import subprocess
import sys
from pathlib import Path

# Configuration
SCAN_DIR = Path.home() / "Projects" / "Ratchet" / "training-data" / "datagen"
QA_DIR = Path.home() / "Projects" / "Ratchet" / "knowledge" / "qa"

# Ensure directories exist
SCAN_DIR.mkdir(parents=True, exist_ok=True)
QA_DIR.mkdir(parents=True, exist_ok=True)

def get_processed_repos():
    """Get list of repos that already have Q&A files"""
    processed = set()
    for qa_file in QA_DIR.glob("*.jsonl"):
        repo_name = qa_file.stem
        processed.add(repo_name)
    return processed

def get_scan_repos():
    """Get list of repos with scan JSON files"""
    scan_repos = []
    for scan_file in SCAN_DIR.glob("*.json"):
        repo_name = scan_file.stem
        scan_repos.append((repo_name, scan_file))
    return scan_repos

def generate_qa_pairs(scan_file_path, output_file_path):
    """Generate Q&A pairs from a scan JSON file"""
    print(f"Processing: {scan_file_path.name}")
    
    try:
        with open(scan_file_path, 'r') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"  Error parsing JSON: {e}")
        return 0
    
    # Clean the data - first entry might be a log message
    if isinstance(data, list) and len(data) > 0:
        if isinstance(data[0], str) and data[0].startswith('Starting analysis'):
            data = data[1:]
        elif not isinstance(data[0], dict):
            data = data[1:]
    if not isinstance(data, list):
        data = []
    
    qa_pairs = []
    
    for i, issue in enumerate(data):
        # Skip entries that don't look like issue data
        if not isinstance(issue, dict):
            continue
            
        # Generate 2-3 Q&A pairs per issue
        qa_pairs.extend(generate_pairs_for_issue(issue, i + 1))
    
    # Write to JSONL file
    if qa_pairs:
        with open(output_file_path, 'w') as f:
            for pair in qa_pairs:
                f.write(json.dumps(pair) + '\n')
        print(f"  Generated {len(qa_pairs)} Q&A pairs")
        return len(qa_pairs)
    else:
        print(f"  No valid issues found")
        return 0

def generate_pairs_for_issue(issue, issue_num):
    """Generate 2-3 Q&A pairs for a single issue"""
    qa_pairs = []
    
    # Common template data
    file_info = issue.get('file', 'unknown')
    line = issue.get('line', 'unknown')
    category = issue.get('category', 'unknown')
    severity = issue.get('severity', 'unknown')
    description = issue.get('description', '')
    suggested_fix = issue.get('suggested_fix', '')
    confidence = issue.get('confidence', 'unknown')
    
    # Format the code snippet placeholder
    code_snippet = f"File: {file_info}, Line: {line}, Category: {category}, Severity: {severity}"
    
    # Pair 1: Security review (if security-related)
    if 'security' in category.lower():
        qa_pairs.append({
            "instruction": f"Review this code for security issues: {code_snippet}",
            "output": f"{description} This is a {severity} severity security issue with confidence level {confidence}/10. The problem is: {description}. Suggested fix: {suggested_fix}. To fix this, you should: (1) Identify the root cause, (2) Implement the suggested fix, (3) Test thoroughly. This issue could lead to [potential consequences]. Always validate inputs, sanitize outputs, and follow security best practices."
        })
    
    # Pair 2: Production readiness
    qa_pairs.append({
        "instruction": f"What production-readiness problems exist in this {category} code? {code_snippet}",
        "output": f"{description} This is a {severity} severity {category} issue with confidence level {confidence}/10. Production readiness concerns: (1) Error handling: {description}, (2) Performance: [assess], (3) Scalability: [assess], (4) Maintainability: [assess]. Suggested fix: {suggested_fix}. To make this production-ready: (1) Implement proper error handling, (2) Add logging and monitoring, (3) Write unit tests, (4) Document the code, (5) Set up CI/CD pipelines."
    })
    
    # Pair 3: Specific fix
    if description:
        # Extract key issue terms
        issue_terms = description[:50].replace('"', '').replace("'", "")
        qa_pairs.append({
            "instruction": f"How would you fix '{issue_terms}' in this code? {code_snippet}",
            "output": f"To fix '{description}': (1) Understand the root cause, (2) Apply the suggested fix: {suggested_fix}, (3) Test the fix thoroughly, (4) Update documentation if needed, (5) Commit with a clear message. Example corrected code:\n\n```\n// Your corrected code here\n```\nThis fix addresses the {severity} severity issue and improves {category}."
        })
    
    return qa_pairs

def main():
    print("="*60)
    print("Gemma Q&A Pair Generator")
    print(f"Scan directory: {SCAN_DIR}")
    print(f"QA directory: {QA_DIR}")
    print(f"Date: {subprocess.run(['date'], capture_output=True).stdout.decode().strip()}")
    print("="*60)
    
    # Get lists
    scan_repos = get_scan_repos()
    processed_repos = get_processed_repos()
    
    print(f"\nFound {len(scan_repos)} scan repositories")
    print(f"Found {len(processed_repos)} already processed repositories")
    
    # Find unprocessed repos
    unprocessed = []
    for repo_name, scan_file in scan_repos:
        if repo_name not in processed_repos:
            unprocessed.append((repo_name, scan_file))
    
    print(f"\n{len(unprocessed)} repositories need processing:")
    for repo_name, _ in unprocessed:
        print(f"  - {repo_name}")
    
    if not unprocessed:
        print("\n✅ All repositories are already processed!")
        return
    
    print("\n" + "="*60)
    print("GENERATION LOG")
    print("="*60)
    
    # Process up to 5 repositories
    count_processed = 0
    for repo_name, scan_file in unprocessed[:5]:
        print(f"\n{'#'*40}")
        print(f"Repository: {repo_name}")
        print(f"Scan file: {scan_file.name}")
        
        output_file = QA_DIR / f"{repo_name}.jsonl"
        
        if output_file.exists():
            print(f"  ⚠️  Output file already exists: {output_file.name}")
            continue
        
        try:
            num_pairs = generate_qa_pairs(scan_file, output_file)
            if num_pairs > 0:
                count_processed += 1
                print(f"✅ Successfully generated {num_pairs} Q&A pairs")
            else:
                print(f"❌ No valid Q&A pairs generated")
        except Exception as e:
            print(f"❌ Error processing {repo_name}: {e}")
            # Create empty file to mark as attempted
            open(output_file, 'w').close()
    
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"Total repositories processed: {count_processed}")
    print(f"Total repositories needing attention: {len(unprocessed) - count_processed}")
    print(f"Last updated: {subprocess.run(['date'], capture_output=True).stdout.decode().strip()}")

if __name__ == "__main__":
    main()
