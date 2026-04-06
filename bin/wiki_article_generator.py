#!/usr/bin/env python3
"""
Ratchet Wiki Article Generator - Template-based version
Processes unprocessed scan files and generates wiki articles
"""

import json
import os
import sys
from pathlib import Path
from typing import List, Dict, Any
from datetime import datetime

def find_unprocessed_scans(datagen_dir: Path, wiki_dir: Path) -> List[Path]:
    """Find JSON files that don't have corresponding wiki articles"""
    unprocessed = []
    
    # Get existing wiki files
    existing_wiki = set()
    if wiki_dir.exists():
        for wiki_file in wiki_dir.glob('*.md'):
            existing_wiki.add(wiki_file.stem)
    
    # Find JSON files without corresponding wiki
    for json_file in datagen_dir.glob('*.json'):
        if json_file.stem not in existing_wiki:
            # Skip empty files
            if json_file.stat().st_size > 100:  # At least 100 bytes
                unprocessed.append(json_file)
    
    return unprocessed

def analyze_scan_data(scan_data: Dict[str, Any]) -> Dict[str, Any]:
    """Analyze scan data and extract key insights"""
    # Extract issues from the scan data
    if isinstance(scan_data, list):
        issues = scan_data
    elif isinstance(scan_data, dict) and 'issues' in scan_data:
        issues = scan_data['issues']
    else:
        issues = []
    
    if not issues:
        return {
            'summary': 'No issues found in the scan.',
            'issues': [],
            'patterns': [],
            'severity': 'Low'
        }
    
    # Group issues by category
    issues_by_category = {}
    for issue in issues:
        category = issue.get('category', 'General')
        if category not in issues_by_category:
            issues_by_category[category] = []
        issues_by_category[category].append(issue)
    
    # Find top 3-5 most severe issues
    severe_issues = sorted(issues, key=lambda x: 
        (x.get('severity', 'Low'), x.get('confidence', 0)), 
        reverse=True)[:5]
    
    # Identify patterns
    patterns = []
    if len(issues_by_category) >= 3:
        top_categories = sorted(issues_by_category.items(), 
                              key=lambda x: len(x[1]), reverse=True)[:3]
        for category, issues_in_cat in top_categories:
            patterns.append({
                'name': f"{category} Issues",
                'description': f"Multiple {category.lower()} issues found throughout the codebase",
                'count': len(issues_in_cat),
                'severity': max(issue.get('severity', 'Low') for issue in issues_in_cat)
            })
    
    # Determine overall severity
    severity_counts = {'High': 0, 'Medium': 0, 'Low': 0}
    for issue in issues:
        severity = issue.get('severity', 'Low')
        if severity in severity_counts:
            severity_counts[severity] += 1
    
    if severity_counts['High'] >= 3 or severity_counts['High'] >= 1 and severity_counts['Medium'] >= 5:
        overall_severity = 'High'
    elif severity_counts['Medium'] >= 3:
        overall_severity = 'Medium'
    else:
        overall_severity = 'Low'
    
    return {
        'summary': f"Found {len(issues)} issues across {len(issues_by_category)} categories. "
                  f"Most severe: {severe_issues[0].get('severity', 'Unknown')} issues.",
        'issues': severe_issues,
        'patterns': patterns,
        'severity': overall_severity,
        'stats': {
            'total_issues': len(issues),
            'categories': len(issues_by_category),
            'severity_distribution': severity_counts
        }
    }

def generate_wiki_article(scan_file: Path, wiki_dir: Path) -> bool:
    """Generate a wiki article from a scan file"""
    try:
        # Read scan data
        scan_data = json.loads(scan_file.read_text())
    except json.JSONDecodeError:
        print(f"⚠️  Skipping {scan_file.name}: Invalid JSON")
        return False
    
    # Extract repo info
    filename = scan_file.stem
    parts = filename.split('-', 1)
    repo_owner = parts[0]
    repo_name = parts[1] if len(parts) > 1 else repo_owner
    
    # Analyze the scan data
    analysis = analyze_scan_data(scan_data)
    
    # Generate the wiki content
    content = f"""# 🔍 Code Analysis Summary Report

**File:** `{scan_file.name}`
**Repository:** `{repo_owner}/{repo_name}`
**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
**Issues Found:** {analysis['stats']['total_issues']}
**Severity:** {analysis['severity']}

## 📊 Summary

{analysis['summary']}

---

## 💡 Analysis by Theme

"""
    
    # Add patterns/themes
    for i, pattern in enumerate(analysis['patterns'], 1):
        content += f"""
### {pattern['name']} (Severity: {pattern['severity']})

**Description:** {pattern['description']}

**Count:** {pattern['count']} issues found

**Example Issues:**
"""
        
        # Add example issues for this pattern
        for issue in analysis['issues']:
            if issue.get('category') == pattern['name'].replace(' Issues', ''):
                content += f"""
- **File:** `{issue.get('file', 'Unknown')}` (Line {issue.get('line', '?')})
- **Description:** {issue.get('description', 'No description')}
- **Suggested Fix:** {issue.get('suggested_fix', 'No fix suggested')}
- **Confidence:** {issue.get('confidence', 0)}%

```
{issue.get('file', 'Unknown')} - Line {issue.get('line', '?')}
{issue.get('description', 'No description')}
```

"""
    
    # Add remediation strategy
    content += """
---

## 🚀 Remediation Strategy (Action Plan)

### 🛠️ Priority 1: Address Critical Issues
Fix all High severity issues first, focusing on:
- Error handling and exception safety
- Security vulnerabilities
- Critical bugs that could cause crashes

### 🛡️ Priority 2: Improve Code Quality
Address Medium severity issues:
- Code quality improvements
- Performance optimizations
- Better error messages and logging

### 📊 Priority 3: Refactoring Opportunities
Consider refactoring for:
- Consistency improvements
- Better naming conventions
- Documentation enhancements

---

## ✨ Summary Table

| Finding Category | Core Problem | Recommended Fix | Priority | Affected Components |
| :--- | :--- | :--- | :--- | :--- |
"""
    
    # Add table rows
    for issue in analysis['issues'][:10]:  # Top 10 issues
        desc = issue.get('description', 'No description')
        suggested_fix = issue.get('suggested_fix', 'Review code')
        content += f"| {issue.get('category', 'General')} | {desc[:50]}... | {suggested_fix[:30]}... | {issue.get('severity', 'Low')} | {issue.get('file', 'Unknown')} |\n"
    
    # Add severity assessment
    content += f"""
---

## 📊 Severity Assessment

**Overall Production-Readiness Opinion:** {'🚨 High Risk' if analysis['severity'] == 'High' else '⚠️ Moderate Risk' if analysis['severity'] == 'Medium' else '✅ Low Risk'} **({analysis['severity']} Severity)**  

**Reasoning:** This repository contains {analysis['stats']['total_issues']} issues with the following severity distribution:
- High: {analysis['stats']['severity_distribution']['High']} issues
- Medium: {analysis['stats']['severity_distribution']['Medium']} issues  
- Low: {analysis['stats']['severity_distribution']['Low']} issues

**Recommendation:** {'Immediate attention required for production use' if analysis['severity'] == 'High' else 'Review and prioritize fixes before production deployment' if analysis['severity'] == 'Medium' else 'Generally safe for production with minor improvements needed'}

---

## 🔗 Additional Information

- **Scan Date:** {datetime.now().strftime('%Y-%m-%d')}
- **Analysis Tool:** Ratchet Code Scanner
- **Repository:** {repo_owner}/{repo_name}
"""
    
    # Write to wiki file
    wiki_file = wiki_dir / f"{repo_owner}-{repo_name}.md"
    wiki_file.write_text(content)
    
    print(f"✅ Generated: {wiki_file.name}")
    return True

def main():
    # Directories
    datagen_dir = Path.home() / 'Projects' / 'Ratchet' / 'training-data' / 'datagen'
    wiki_dir = Path.home() / 'Projects' / 'Ratchet' / 'knowledge' / 'wiki'
    
    # Ensure directories exist
    wiki_dir.mkdir(parents=True, exist_ok=True)
    
    print("🔍 Ratchet Wiki Article Generator")
    print("=" * 50)
    
    # Find unprocessed scans
    unprocessed = find_unprocessed_scans(datagen_dir, wiki_dir)
    
    print(f"Found {len(unprocessed)} unprocessed scan files")
    
    if not unprocessed:
        print("✅ All scans have been processed")
        return 0
    
    # Process up to 5 files
    processed_count = 0
    success_count = 0
    
    for scan_file in unprocessed[:5]:  # Limit to 5 per run
        print(f"\n📝 Processing: {scan_file.name}")
        if generate_wiki_article(scan_file, wiki_dir):
            success_count += 1
        processed_count += 1
    
    print(f"\n📊 Summary: {success_count}/{processed_count} articles generated successfully")
    
    return 0

if __name__ == '__main__':
    sys.exit(main())