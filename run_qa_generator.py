#!/usr/bin/env python3
import os
import sys
import json
import time
import requests
from requests.exceptions import Timeout, ConnectionError

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

def chunk_code(code, max_lines=100):
    """Break large code files into smaller chunks."""
    lines = code.split('\n')
    for i in range(0, len(lines), max_lines):
        chunk = '\n'.join(lines[i:i + max_lines])
        yield chunk, i + 1  # Return chunk and starting line number

def generate_qa_pairs(issue):
    """Generate Q&A pairs for a single issue with adaptive timeout."""
    qa_pairs = []
    
    file_path = issue.get("file", "")
    line_num = issue.get("line", "")
    category = issue.get("category", "")
    severity = issue.get("severity", "")
    description = issue.get("description", "")
    suggested_fix = issue.get("suggested_fix", "")
    confidence = issue.get("confidence", "")
    
    # Determine timeout based on issue complexity
    timeout_multiplier = 1.0
    if "large" in description.lower() or "god class" in description.lower():
        timeout_multiplier = 2.5  # More time for complex architectural issues
    
    current_timeout = int(BASE_TIMEOUT * timeout_multiplier)
    
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
    
    response1 = generate_with_timeout(prompt1, current_timeout)
    if response1:
        qa_pairs.append({
            "instruction": f"Review this code for security issues: {description}",
            "output": response1
        })
    
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
    
    response2 = generate_with_timeout(prompt2, current_timeout)
    if response2:
        qa_pairs.append({
            "instruction": f"What production-readiness problems exist in this {language} code? {description}",
            "output": response2
        })
    
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
        
        response3 = generate_with_timeout(prompt3, current_timeout)
        if response3:
            qa_pairs.append({
                "instruction": f"How would you fix the issue in this code? {description}",
                "output": response3
            })
    
    return qa_pairs

def process_datagen_file(filepath):
    """Process a single datagen JSON file."""
    print(f"\n📁 Processing {os.path.basename(filepath)}...")
    
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Error loading {filepath}: {e}")
        return []
    
    qa_pairs = []
    total_issues = len(data) if isinstance(data, list) else 1
    
    print(f"  Found {total_issues} issues")
    
    # Handle different data structures
    if isinstance(data, list):
        for i, issue in enumerate(data):
            print(f"  Processing issue {i + 1}/{total_issues}: {issue.get('description', 'Unknown')[:50]}...")
            pairs = generate_qa_pairs(issue)
            qa_pairs.extend(pairs)
            if pairs:
                print(f"    ✓ Generated {len(pairs)} Q&A pairs")
            else:
                print(f"    ✗ Failed to generate Q&A pairs")
    else:
        # Handle single object (like vuejs-vue)
        print(f"  Processing complex object...")
        pairs = generate_qa_pairs(data)
        qa_pairs.extend(pairs)
    
    return qa_pairs

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
    
    # Find missing files
    processed = 0
    for datagen_file in datagen_files:
        if datagen_file not in qa_basenames:
            filepath = os.path.join(datagen_dir, datagen_file)
            
            # Process up to 3 files per run to avoid timeouts
            if processed >= 3:
                print(f"\n⚠️  Reached processing limit. More files remaining.")
                break
            
            print(f"\n{'='*60}")
            print(f"Processing: {datagen_file}")
            print(f"{'='*60}")
            
            qa_pairs = process_datagen_file(filepath)
            
            if qa_pairs:
                # Save as JSONL
                qa_filename = datagen_file.replace('.json', '.jsonl')
                qa_path = os.path.join(qa_dir, qa_filename)
                
                with open(qa_path, 'w', encoding='utf-8') as f:
                    for pair in qa_pairs:
                        f.write(json.dumps(pair, ensure_ascii=False) + '\n')
                
                print(f"\n✅ Successfully saved {len(qa_pairs)} Q&A pairs to {qa_filename}")
            else:
                print(f"\n❌ No Q&A pairs generated for {datagen_file}")
            
            processed += 1
    
    print(f"\n{'='*60}")
    print("Processing complete!")
    print(f"Processed {processed} new file(s)")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
