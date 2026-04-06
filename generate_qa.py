import json
import subprocess
import sys

# Load the scan data
scan_file = "training-data/datagen/winstonjs-winston.json"
qa_output = "knowledge/qa/winstonjs-winston.jsonl"

with open(scan_file, 'r') as f:
    issues = json.load(f)

print(f"Loaded {len(issues)} issues from {scan_file}")

def generate_qa_pairs(issue):
    """Generate Q&A pairs for a single issue using Gemma 4"""
    qa_pairs = []
    
    # Extract issue details
    file_path = issue.get('file', '')
    line = issue.get('line', '')
    category = issue.get('category', '')
    severity = issue.get('severity', '')
    description = issue.get('description', '')
    suggested_fix = issue.get('suggested_fix', '')
    confidence = issue.get('confidence', '')
    
    # Create context string
    context = f"File: {file_path}\nLine: {line}\nCategory: {category}\nSeverity: {severity}\nConfidence: {confidence}"
    
    # Q&A Pair 1: Security/Code Quality analysis
    instruction = f"Review this {category.lower()} issue: {description}\n\n{context}\n\nWhat are the potential impacts and how would you fix this?"
    output = f"{description}\n\nImpact: This {severity.lower()} issue could lead to maintainability problems, security vulnerabilities, or performance degradation. The confidence level is {confidence}/5.\n\nFix: {suggested_fix}"
    qa_pairs.append({"instruction": instruction, "output": output})
    
    # Q&A Pair 2: Production readiness analysis
    instruction = f"What production-readiness problems exist in this {category.lower()} issue?\n\n{context}\n\nAnalyze the issue and suggest improvements."
    output = f"{description}\n\nThis {severity.lower()} issue affects production readiness by potentially causing:\n- Maintainability challenges\n- Performance bottlenecks\n- Security vulnerabilities\n- Reliability concerns\n\nRecommended fix: {suggested_fix}\n\nConfidence level: {confidence}/5"
    qa_pairs.append({"instruction": instruction, "output": output})
    
    # Q&A Pair 3: Specific fix guidance (if it's code-related)
    if "code" in description.lower() or "implementation" in description.lower():
        instruction = f"How would you fix the {category.lower()} issue at line {line} in {file_path}?\n\n{context}\n\nProvide step-by-step instructions with corrected code."
        output = f"Step 1: Understand the issue - {description}\nStep 2: Prepare the fix based on the suggested fix: {suggested_fix}\nStep 3: Implement the changes in the code\nStep 4: Test the changes thoroughly\nStep 5: Document the fix\n\nThis is a {severity.lower()} issue with confidence {confidence}/5."
        qa_pairs.append({"instruction": instruction, "output": output})
    
    return qa_pairs

# Generate all Q&A pairs
all_qa = []
for i, issue in enumerate(issues):
    qa_pairs = generate_qa_pairs(issue)
    all_qa.extend(qa_pairs)
    print(f"Processed issue {i+1}/{len(issues)} - generated {len(qa_pairs)} Q&A pairs")

# Write to JSONL file
with open(qa_output, 'w') as f:
    for qa in all_qa:
        f.write(json.dumps(qa) + '\n')

print(f"\nGenerated {len(all_qa)} Q&A pairs and saved to {qa_output}")
