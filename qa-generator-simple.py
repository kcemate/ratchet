#!/usr/bin/env python3
import json
import os
import sys
import time
import requests
from requests.exceptions import Timeout, ConnectionError
import threading

# Configuration
OLLAMA_API_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "gemma4:e4b"
BASE_TIMEOUT = 60  # Base timeout per generation
MAX_RETRIES = 2

def generate_with_timeout(prompt, timeout=BASE_TIMEOUT):
    """Generate text using Ollama API with timeout and retry logic."""
    for attempt in range(MAX_RETRIES + 1):
        result = {"generated": "", "error": None}
        
        def worker():
            try:
                response = requests.post(
                    OLLAMA_API_URL,
                    json={
                        "model": MODEL_NAME,
                        "prompt": prompt,
                        "options": {"num_predict": 800}  # Limit response length
                    },
                    timeout=40  # HTTP timeout for the request itself
                )
                if response.status_code == 200:
                    data = response.json()
                    if "response" in data:
                        result["generated"] = data["response"].strip()
                    else:
                        result["error"] = "No response in API output"
                else:
                    result["error"] = f"API error: {response.status_code}"
            except ConnectionError:
                result["error"] = "Connection error"
            except Timeout:
                result["error"] = "API request timeout"
            except Exception as e:
                result["error"] = f"Exception: {str(e)}"
        
        thread = threading.Thread(target=worker)
        thread.start()
        thread.join(timeout=timeout)
        
        if thread.is_alive():
            result["error"] = "Generation timed out"
            thread.join(timeout=5)  # Wait a bit for cleanup
        
        if result["generated"]:
            return result["generated"]
        
        if attempt < MAX_RETRIES:
            print(f"  Retrying ({attempt + 1}/{MAX_RETRIES + 1})...")
            time.sleep(2)
        else:
            return None

def process_issue(issue, repo_name):
    """Process a single issue and generate Q&A pairs."""
    file_path = issue.get("file", "")
    line_num = issue.get("line", "")
    category = issue.get("category", "")
    severity = issue.get("severity", "")
    description = issue.get("description", "")
    suggested_fix = issue.get("suggested_fix", "")
    confidence = issue.get("confidence", "")
    
    print(f"  Issue: {description[:80]}...")
    print(f"    File: {file_path}, Line: {line_num}")
    
    qa_pairs = []
    
    # Format 1: Security review
    prompt1 = f"""Review this code for security issues:
File: {file_path}
Line: {line_num}
Category: {category}
Severity: {severity}
Description: {description}
Suggested Fix: {suggested_fix}
Confidence: {confidence}

Provide a detailed analysis with severity, explanation, and fix."""
    
    print(f"    Generating security review...")
    response1 = generate_with_timeout(prompt1)
    if response1:
        qa_pairs.append({
            "instruction": f"Review this code for security issues: {description}",
            "output": response1
        })
        print(f"      ✓ Generated security review Q&A")
    
    # Format 2: Production readiness
    language = "python"
    if file_path.endswith((".js", ".jsx")):
        language = "JavaScript"
    elif file_path.endswith(".ts"):
        language = "TypeScript"
    elif file_path.endswith(".go"):
        language = "Go"
    elif file_path.endswith(".rs"):
        language = "Rust"
    elif file_path.endswith(".java"):
        language = "Java"
    
    prompt2 = f"""What production-readiness problems exist in this {language} code?
File: {file_path}
Line: {line_num}
Category: {category}
Severity: {severity}
Description: {description}
Suggested Fix: {suggested_fix}
Confidence: {confidence}

Provide a structured analysis."""
    
    print(f"    Generating production readiness...")
    response2 = generate_with_timeout(prompt2)
    if response2:
        qa_pairs.append({
            "instruction": f"What production-readiness problems exist in this {language} code? {description}",
            "output": response2
        })
        print(f"      ✓ Generated production readiness Q&A")
    
    # Format 3: Specific fix
    if suggested_fix:
        prompt3 = f"""How would you fix the issue in this code?
File: {file_path}
Line: {line_num}
Category: {category}
Severity: {severity}
Description: {description}
Suggested Fix: {suggested_fix}
Confidence: {confidence}

Break down the solution into clear steps."""
        
        print(f"    Generating specific fix...")
        response3 = generate_with_timeout(prompt3)
        if response3:
            qa_pairs.append({
                "instruction": f"How would you fix the issue in this code? {description}",
                "output": response3
            })
            print(f"      ✓ Generated specific fix Q&A")
    
    return qa_pairs

def process_datagen_file(filepath, max_issues=3):
    """Process a single datagen JSON file with limited issues."""
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
    
    # Process up to max_issues issues per run
    issues_to_process = data[:max_issues] if isinstance(data, list) else [data]
    
    for i, issue in enumerate(issues_to_process):
        print(f"\n  {'='*60}")
        print(f"  Issue {i + 1}/{len(issues_to_process)}")
        print(f"  {'='*60}")
        
        pairs = process_issue(issue, os.path.basename(filepath))
        qa_pairs.extend(pairs)
        
        if pairs:
            print(f"  ✓ Generated {len(pairs)} Q&A pairs for this issue")
        else:
            print(f"  ✗ Failed to generate Q&A pairs for this issue")
        
        # Save after each issue to avoid losing progress
        if pairs:
            save_qa_pairs(filepath, qa_pairs)
    
    return len(qa_pairs)

def save_qa_pairs(datagen_file, qa_pairs):
    """Save Q&A pairs to JSONL file."""
    qa_dir = "~/Projects/Ratchet/knowledge/qa"
    qa_dir = os.path.expanduser(qa_dir)
    
    if not os.path.exists(qa_dir):
        os.makedirs(qa_dir)
    
    qa_filename = os.path.basename(datagen_file).replace('.json', '.jsonl')
    qa_path = os.path.join(qa_dir, qa_filename)
    
    # Append new pairs to existing file
    mode = 'a' if os.path.exists(qa_path) else 'w'
    
    with open(qa_path, mode, encoding='utf-8') as f:
        for pair in qa_pairs:
            f.write(json.dumps(pair, ensure_ascii=False) + '\n')
    
    print(f"  💾 Saved {len(qa_pairs)} Q&A pairs to {qa_filename}")

def main():
    datagen_dir = "~/Projects/Ratchet/training-data/datagen"
    datagen_dir = os.path.expanduser(datagen_dir)
    
    if not os.path.exists(datagen_dir):
        print(f"❌ Datagen directory not found: {datagen_dir}")
        return
    
    # Get all JSON files in datagen directory
    datagen_files = [f for f in os.listdir(datagen_dir) if f.endswith('.json')]
    print(f"Found {len(datagen_files)} datagen files")
    
    # Get existing QA files
    qa_dir = "~/Projects/Ratchet/knowledge/qa"
    qa_dir = os.path.expanduser(qa_dir)
    qa_files = []
    if os.path.exists(qa_dir):
        qa_files = [f for f in os.listdir(qa_dir) if f.endswith('.jsonl')]
    qa_basenames = [f.replace('.jsonl', '.json') for f in qa_files]
    print(f"Found {len(qa_files)} existing QA files")
    
    # Find and process missing files (limit 1 per run for testing)
    for datagen_file in datagen_files:
        if datagen_file not in qa_basenames:
            filepath = os.path.join(datagen_dir, datagen_file)
            
            print(f"\n{'='*70}")
            print(f"Starting processing: {datagen_file}")
            print(f"{'='*70}")
            
            # Process just 1 file per run to avoid timeouts
            count = process_datagen_file(filepath, max_issues=2)
            
            print(f"\n{'='*70}")
            print(f"Finished processing {datagen_file}")
            print(f"Generated {count} Q&A pairs")
            print(f"{'='*70}")
            
            # Stop after one file to test
            print("\nTest complete. Exiting after one file.")
            break

if __name__ == "__main__":
    main()
