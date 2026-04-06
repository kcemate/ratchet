#!/usr/bin/env python3
import os
import json
import sys

def generate_qa_pairs(issue):
    """Generate Q&A pairs for a single issue."""
    qa_pairs = []
    
    file_path = issue.get("file", "")
    line_num = issue.get("line", "")
    category = issue.get("category", "")
    severity = issue.get("severity", "")
    description = issue.get("description", "")
    suggested_fix = issue.get("suggested_fix", "")
    confidence = issue.get("confidence", "")
    
    # Q&A Pair 1: Security/Code Quality analysis
    instruction1 = f"Review this {category.lower()} issue: {description}\n\nFile: {file_path}\nLine: {line_num}\nSeverity: {severity}\nConfidence: {confidence}\n\nWhat are the potential impacts and how would you fix this?"
    output1 = f"{description}\n\nImpact: This {severity.lower()} issue could lead to maintainability problems, security vulnerabilities, or performance degradation. The confidence level is {confidence}/5.\n\nFix: {suggested_fix}"
    qa_pairs.append({"instruction": instruction1, "output": output1})
    
    # Q&A Pair 2: Production readiness analysis
    instruction2 = f"What production-readiness problems exist in this {category.lower()} issue?\n\nFile: {file_path}\nLine: {line_num}\nSeverity: {severity}\nConfidence: {confidence}\n\nAnalyze the issue and suggest improvements."
    output2 = f"{description}\n\nThis {severity.lower()} issue affects production readiness by potentially causing:\n- Maintainability challenges\n- Performance bottlenecks\n- Security vulnerabilities\n- Reliability concerns\n\nRecommended fix: {suggested_fix}\n\nConfidence level: {confidence}/5"
    qa_pairs.append({"instruction": instruction2, "output": output2})
    
    # Q&A Pair 3: Specific fix guidance (if it's code-related)
    if "code" in description.lower() or "implementation" in description.lower():
        instruction3 = f"How would you fix the {category.lower()} issue at line {line_num} in {file_path}?\n\nFile: {file_path}\nLine: {line_num}\nSeverity: {severity}\nConfidence: {confidence}\n\nProvide step-by-step instructions with corrected code."
        output3 = f"Step 1: Understand the issue - {description}\nStep 2: Prepare the fix based on the suggested fix: {suggested_fix}\nStep 3: Implement the changes in the code\nStep 4: Test the changes thoroughly\nStep 5: Document the fix\n\nThis is a {severity.lower()} issue with confidence {confidence}/5."
        qa_pairs.append({"instruction": instruction3, "output": output3})
    
    return qa_pairs

def process_datagen_file(filepath, qa_path):
    """Process a single datagen JSON file."""
    print(f"\n📁 Processing {os.path.basename(filepath)}...")
    
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Error loading {filepath}: {e}")
        return 0
    
    qa_pairs = []
    total_issues = len(data) if isinstance(data, list) else 1
    
    print(f"  Found {total_issues} issues")
    
    # Handle different data structures
    if isinstance(data, list):
        for i, issue in enumerate(data):
            print(f"  Processing issue {i + 1}/{total_issues}: {issue.get('description', 'Unknown')[:50]}...")
            pairs = generate_qa_pairs(issue)
            qa_pairs.extend(pairs)
            print(f"    ✓ Generated {len(pairs)} Q&A pairs")
    else:
        # Handle single object
        print(f"  Processing complex object...")
        pairs = generate_qa_pairs(data)
        qa_pairs.extend(pairs)
    
    # Save as JSONL
    with open(qa_path, 'w', encoding='utf-8') as f:
        for pair in qa_pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + '\n')
    
    print(f"\n✅ Successfully saved {len(qa_pairs)} Q&A pairs to {os.path.basename(qa_path)}")
    return len(qa_pairs)

def main():
    datagen_dir = "~/Projects/Ratchet/training-data/datagen"
    qa_dir = "~/Projects/Ratchet/knowledge/qa"
    
    datagen_dir = os.path.expanduser(datagen_dir)
    qa_dir = os.path.expanduser(qa_dir)
    
    if not os.path.exists(datagen_dir):
        print(f"❌ Datagen directory not found: {datagen_dir}")
        return
    
    if not os.path.exists(qa_dir):
        os.makedirs(qa_dir)
        print(f"📁 Created QA directory: {qa_dir}")
    
    # Get all JSON files in datagen directory
    datagen_files = [f for f in os.listdir(datagen_dir) if f.endswith('.json')]
    print(f"Found {len(datagen_files)} datagen files")
    
    # Get existing QA files
    qa_files = [f for f in os.listdir(qa_dir) if f.endswith('.jsonl')]
    qa_basenames = [f.replace('.jsonl', '.json') for f in qa_files]
    print(f"Found {len(qa_files)} existing QA files")
    
    # Find files that need processing (empty or missing)
    to_process = []
    for datagen_file in datagen_files:
        qa_file = datagen_file.replace('.json', '.jsonl')
        qa_path = os.path.join(qa_dir, qa_file)
        
        if datagen_file not in qa_basenames:
            to_process.append((datagen_file, os.path.join(datagen_dir, datagen_file), qa_path))
        else:
            # Check if file is empty
            if os.path.getsize(qa_path) == 0:
                to_process.append((datagen_file, os.path.join(datagen_dir, datagen_file), qa_path))
    
    print(f"\nRepositories to process: {len(to_process)}")
    
    # Process up to 5 files
    processed = 0
    total_qa_pairs = 0
    for i, (datagen_file, scan_file, qa_path) in enumerate(to_process[:5]):
        print(f"\n{'='*60}")
        print(f"Processing {i+1}/5: {datagen_file}")
        print(f"{'='*60}")
        
        pairs_generated = process_datagen_file(scan_file, qa_path)
        total_qa_pairs += pairs_generated
        processed += 1
    
    print(f"\n{'='*60}")
    print("Processing complete!")
    print(f"Processed {processed} file(s)")
    print(f"Generated {total_qa_pairs} Q&A pairs total")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
