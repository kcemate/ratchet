#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'open3'
require 'tempfile'

# Configuration
scan_file = ARGV[0]
wiki_dir = File.expand_path('~/Projects/Ratchet/knowledge/wiki')

unless scan_file && File.exist?(scan_file)
  puts "Usage: #{__FILE__} <scan_file.json>"
  exit 1
end

# Read scan data
scan_data = JSON.parse(File.read(scan_file))

# Extract repo info
filename = File.basename(scan_file, '.json')
repo_owner, repo_name = filename.split('-', 2).map(&:strip)

# Build the prompt
prompt = <<~PROMPT
  You are an expert code analysis writer and quality assessor. Transform the raw scan JSON data below into a comprehensive, actionable wiki article.

  SCAN_DATA: #{scan_data.to_json}

  ARTICLE REQUIREMENTS:
  - Depth over breadth: Provide thorough analysis of significant issues
  - Concrete examples: Include specific code snippets from the scan
  - Actionable guidance: Every problem must have clear, implementable solutions
  - Structured clarity: Organize for easy scanning and reference

  ARTICLE STRUCTURE:
  - Title: #{repo_owner}-#{repo_name}
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
  - Use emojis sparingly for emphasis (🔍, 🚨, ✅, 💡)
  - Keep explanations concise but thorough

  OUTPUT FORMAT:
  ```markdown
  🔍 Code Analysis Summary Report

  **File:** `#{scan_file}`
  **Primary Focus:** {primary_focus_areas}

  {opening_summary}

  ---

  ## 💡 Analysis by Theme

  ### {Theme 1 Name} (Severity: {level}, Confidence: {level})
  {detailed_analysis_with_code_examples}

  ### {Theme 2 Name} (Severity: {level}, Confidence: {level})
  {detailed_analysis_with_code_examples}

  ...

  ## 🚀 Remediation Strategy (Action Plan)

  ### 🛠️ Priority 1: {Most_critical_fix}
  {description}

  ### 🛡️ Priority 2: {Important_fix}
  {description}

  ### 📊 Priority 3: {Nice_to_have}
  {description}

  ---

  ## ✨ Summary Table

  | Finding Category | Core Problem | Recommended Fix | Priority | Affected Components |
  | :--- | :--- | :--- | :--- | :--- |

  ---

  ## 📊 Severity Assessment

  **Overall Production-Readiness Opinion:** {emoji} **{Risk_Level}**  
  {reasoning}

  **Recommendation:** {action}
  ```

  Generate the comprehensive wiki article for the #{repo_owner}-#{repo_name} repository.
PROMPT

# Run ollama
cmd = "ollama run gemma4:e4b"
stdin, stdout, stderr, wait_thr = Open3.popen3(cmd)

# Send the prompt
stdin.puts(prompt)
stdin.close

# Capture output
output = stdout.read
errors = stderr.read

# Check for errors
if errors.include?('error') || errors.include?('Error')
  puts "Ollama error: #{errors}"
  exit 1
end

# Extract the generated content (look for the markdown code block)
if output.include?('```markdown')
  start_idx = output.index('```markdown') + 13
  end_idx = output.index('```', start_idx) - 1
  content = output[start_idx..end_idx].strip
else
  # Fallback: extract between the prompt and the end
  content = output.gsub(/SCAN_DATA:.*Generate the comprehensive wiki article for the.*repository\./m, '').strip
end

# Write to wiki file
wiki_file = File.join(wiki_dir, "#{repo_owner}-#{repo_name}.md")
File.write(wiki_file, content)

puts "✅ Generated: #{wiki_file}"
puts "\nGenerated content:\n\n#{content}"

exit 0