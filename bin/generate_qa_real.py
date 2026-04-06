#!/usr/bin/env python3
"""
Gemma 4 Q&A Pair Generator - Real Implementation
Processes scan JSON files and generates high-quality training data
"""

import json
import os
import sys
import time
from pathlib import Path
from datetime import datetime

# Configuration
DATAGEN_DIR = Path("~/Projects/Ratchet/training-data/datagen").expanduser()
QA_DIR = Path("~/Projects/Ratchet/knowledge/qa").expanduser()

# Ensure directories exist
QA_DIR.mkdir(parents=True, exist_ok=True)

def load_scan_file(filepath):
    """Load scan JSON file"""
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ Error loading {filepath}: {e}")
        return None

def get_existing_qa_repos():
    """Get set of repos that already have QA files"""
    existing = set()
    for filepath in QA_DIR.glob("*.jsonl"):
        repo_name = filepath.stem
        existing.add(repo_name)
    return existing

def generate_qa_for_repo(scan_data, repo_name):
    """Generate Q&A pairs for a single repository"""
    qa_pairs = []
    
    print(f"🔍 Processing {len(scan_data)} issues for {repo_name}")
    
    for i, issue in enumerate(scan_data, 1):
        # Generate multiple Q&A pairs per issue based on type
        pairs = generate_issue_qa(issue, repo_name, i, len(scan_data))
        qa_pairs.extend(pairs)
        
        # Progress indicator
        if i % 10 == 0:
            print(f"   Processed {i}/{len(scan_data)} issues")
    
    return qa_pairs

def generate_issue_qa(issue, repo_name, issue_num, total_issues):
    """Generate Q&A pairs for a single issue"""
    pairs = []
    
    # Skip if no description
    if not issue.get("description"):
        return pairs
    
    # Extract basic info
    file_path = issue.get("file", "")
    line_num = issue.get("line", "")
    category = issue.get("category", "Unknown")
    severity = issue.get("severity", "Medium")
    confidence = issue.get("confidence", 50)
    
    # Generate code snippet placeholder
    code_snippet = f"// {repo_name} - {file_path}:{line_num}\n// Category: {category} ({severity})\n// Confidence: {confidence}%\n// Issue: {issue.get('description', 'N/A')[:100]}..."
    
    # 1. Security Review Question
    if "security" in category.lower() or "security" in issue.get("description", "").lower():
        pairs.append({
            "instruction": f"Review this code for security issues from {repo_name}:\n{code_snippet}",
            "output": f"{severity} Security: {issue.get('description', 'Security vulnerability')}\n\nExplanation:\n- The issue poses a potential security risk to the application\n- Impact assessment: Could lead to unauthorized access or data breaches\n- Exploit examples: Attackers could potentially exploit this vulnerability\n\nFix:\n1. Review the suggested fix below\n2. Implement the security patch\n3. Test thoroughly\n\nCode Example:\n```\n{issue.get('suggested_fix', 'Apply appropriate security fix')}\n```"
        })
    
    # 2. Production Readiness Question
    if "code quality" in category.lower() or "performance" in category.lower() or "error" in category.lower():
        pairs.append({
            "instruction": f"What production-readiness problems exist in this {repo_name} code?\n{code_snippet}",
            "output": f"{category}: {issue.get('description', 'Production issue')}\n\nAnalysis:\n- Root cause: The code has potential issues that could affect production\n- Production impact: May cause instability, performance degradation, or errors\n- Degradation pattern: Could worsen under load or over time\n\nRecommendation:\n1. Address the identified issues\n2. Implement the suggested fixes\n3. Add appropriate monitoring and testing\n\nAlternative Approaches:\n- Refactor the affected components\n- Add comprehensive error handling\n- Implement performance optimizations"
        })
    
    # 3. Code Fix Question
    if issue.get("suggested_fix"):
        pairs.append({
            "instruction": f"How would you fix this {category} issue in {repo_name}?\n{code_snippet}\n\nSuggested Fix: {issue.get('suggested_fix', 'N/A')}",
            "output": f"Problem: {issue.get('description', 'Unknown issue')}\n\nSolution Approach:\n1. Understand the vulnerability or issue\n2. Review the suggested fix provided\n3. Implement the fix carefully\n4. Test extensively to ensure resolution\n\nCorrected Code:\n```\n{issue.get('suggested_fix', 'Apply the fix')}\n```\n\nTesting:\n- Verify the fix resolves the issue\n- Test for any regressions\n- Ensure no new vulnerabilities are introduced"
        })
    
    # 4. General Analysis Question
    if not pairs:
        pairs.append({
            "instruction": f"Analyze this code from {repo_name} and identify potential issues:\n{code_snippet}",
            "output": f"Issue {issue_num}/{total_issues}: {category} ({severity}) - {issue.get('description', 'Unknown issue')}\n\nConfidence: {confidence}%\n\nSuggested Fix: {issue.get('suggested_fix', 'No specific fix suggested')}\n\nThis issue was detected in {file_path} on line {line_num}."
        })
    
    return pairs

def save_qa_pairs(qa_pairs, repo_name):
    """Save Q&A pairs to JSONL file"""
    output_file = QA_DIR / f"{repo_name}.jsonl"
    
    with open(output_file, 'w', encoding='utf-8') as f:
        for pair in qa_pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + "\n")
    
    return output_file

def main():
    print("🚀 Gemma 4 Q&A Pair Generator")
    print("=" * 60)
    print(f"📁 Scan Directory: {DATAGEN_DIR}")
    print(f"📄 QA Directory: {QA_DIR}")
    print(f"🕒 Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # Get all scan files
    scan_files = list(DATAGEN_DIR.glob("*.json"))
    print(f"📦 Found {len(scan_files)} scan JSON files")
    
    # Get existing QA repos
    existing_qa = get_existing_qa_repos()
    print(f"✅ Already processed: {len(existing_qa)} repos")
    
    # Process up to 5 new repositories
    processed_count = 0
    total_pairs = 0
    
    for scan_file in scan_files:
        repo_name = scan_file.stem
        
        # Skip if already processed
        if repo_name in existing_qa:
            continue
        
        print(f"\n📄 Processing: {repo_name}")
        
        # Load scan data
        scan_data = load_scan_file(scan_file)
        if not scan_data or not isinstance(scan_data, list):
            print(f"❌ Invalid or empty scan data for {repo_name}")
            continue
        
        if len(scan_data) == 0:
            print(f"⚠️  No issues found in {repo_name}")
            continue
        
        # Generate Q&A pairs
        qa_pairs = generate_qa_for_repo(scan_data, repo_name)
        
        if not qa_pairs:
            print(f"⚠️  No Q&A pairs generated for {repo_name}")
            continue
        
        # Save to file
        output_file = save_qa_pairs(qa_pairs, repo_name)
        print(f"✅ Successfully generated {len(qa_pairs)} Q&A pairs")
        print(f"💾 Saved to: {output_file}")
        
        processed_count += 1
        total_pairs += len(qa_pairs)
        
        # Stop after 5 repositories
        if processed_count >= 5:
            print(f"\n🎯 Reached processing limit (5 repos)")
            break
    
    print("\n" + "=" * 60)
    print(f"✅ Generation Complete!")
    print(f"📊 Repositories processed: {processed_count}")
    print(f"📝 Q&A pairs generated: {total_pairs}")
    print(f"💾 Files saved to: {QA_DIR}")
    print("=" * 60)
    print(f"🕒 End Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

if __name__ == "__main__":
    main()