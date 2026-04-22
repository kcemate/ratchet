with open('src/core/agents/shell.ts', 'r') as f:
    content = f.read()
lines = content.splitlines(keepends=True)
for i, line in enumerate(lines):
    if '- Do NOT change formatting, whitespace, or style in untouched lines' in line:
        new_line = "    `\\\\- ANY EXTRA OUTPUT WILL CAUSE ROLLBACK. Output ONLY the line 'MODIFIED: <filepath>' and nothing else.\\\\n` +\\n"
        lines.insert(i, new_line)
        break
with open('src/core/agents/shell.ts', 'w') as f:
    f.writelines(lines)
