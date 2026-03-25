#!/usr/bin/env python3
"""Augment training data for Ratchet Fix model."""

import json
import re
import random
from pathlib import Path

INPUT_FILE = Path("/Users/giovanni/Projects/ratchet/training-data/ratchet-fix-v1.jsonl")
OUTPUT_FILE = Path("/Users/giovanni/Projects/ratchet/training-data/ratchet-fix-augmented.jsonl")

# File path substitution maps
FILE_PATH_VARIANTS = {
    "src/commands/badge.ts": [
        "src/commands/analyze.ts",
        "src/commands/deploy.ts",
        "src/commands/export.ts",
        "src/commands/report.ts",
        "src/commands/watch.ts",
    ],
    "src/commands/build.ts": [
        "src/commands/sync.ts",
        "src/commands/init.ts",
        "src/commands/report.ts",
        "src/commands/watch.ts",
        "src/commands/deploy.ts",
    ],
    "src/commands/improve.ts": [
        "src/commands/analyze.ts",
        "src/commands/export.ts",
        "src/commands/sync.ts",
        "src/commands/watch.ts",
        "src/commands/init.ts",
    ],
    "server/routes.ts": [
        "server/api.ts",
        "server/handlers.ts",
        "server/middleware.ts",
        "server/controllers.ts",
        "server/endpoints.ts",
    ],
    "client/src/pages/index.tsx": [
        "client/src/pages/dashboard.tsx",
        "client/src/pages/profile.tsx",
        "client/src/pages/settings.tsx",
        "client/src/pages/home.tsx",
        "client/src/pages/login.tsx",
    ],
    "client/src/components/Badge.tsx": [
        "client/src/components/modal.tsx",
        "client/src/components/form.tsx",
        "client/src/components/table.tsx",
        "client/src/components/card.tsx",
        "client/src/components/button.tsx",
    ],
}

# Default path variants for any path not in the map
DEFAULT_PATH_VARIANTS = [
    "src/commands/analyze.ts",
    "src/commands/deploy.ts",
    "src/commands/export.ts",
    "src/commands/report.ts",
    "src/commands/watch.ts",
    "src/commands/sync.ts",
    "src/commands/init.ts",
    "server/api.ts",
    "server/handlers.ts",
    "server/middleware.ts",
    "server/controllers.ts",
    "server/endpoints.ts",
]

# Variable name substitution sets (applied consistently across both user and assistant code)
VAR_SUBSTITUTION_SETS = [
    {"user": "account", "data": "payload", "result": "response"},
    {"user": "member", "data": "record", "result": "output"},
    {"error": "err", "items": "records", "config": "settings"},
    {"options": "params", "request": "req", "response": "res"},
]

# Function name substitution patterns
FUNCTION_NAME_VARIANTS = {
    "badgeCommand": ["exportCommand", "analyzeCommand", "deployCommand", "reportCommand"],
    "buildCommand": ["syncCommand", "initCommand", "watchCommand", "deployCommand"],
    "improveCommand": ["analyzeCommand", "exportCommand", "reportCommand", "syncCommand"],
    "getUser": ["fetchAccount", "loadMember", "retrieveUser", "findAccount"],
    "createUser": ["addAccount", "registerMember", "insertUser", "createAccount"],
    "updateUser": ["modifyAccount", "editMember", "patchUser", "updateAccount"],
    "deleteUser": ["removeAccount", "deactivateMember", "purgeUser", "deleteAccount"],
    "getData": ["fetchPayload", "loadRecord", "retrieveData", "getPayload"],
    "handleError": ["processError", "catchError", "onError", "handleFailure"],
    "processRequest": ["handleRequest", "routeRequest", "dispatchRequest", "executeRequest"],
    "runScan": ["runAnalysis", "executeCheck", "performScan", "runInspection"],
    "saveRun": ["persistRun", "storeRun", "recordRun", "commitRun"],
    "requireLicense": ["validateLicense", "checkLicense", "verifyLicense", "enforceLicense"],
    "exitWithError": ["failWithError", "abortWithError", "throwError", "terminateWithError"],
    "printHeader": ["renderHeader", "displayHeader", "showHeader", "outputHeader"],
    "printFields": ["renderFields", "displayFields", "showFields", "outputFields"],
}

# Error message substitutions
ERROR_MSG_VARIANTS = [
    ("Failed to load", "Could not fetch"),
    ("Failed to load", "Unable to retrieve"),
    ("Invalid", "Unsupported"),
    ("Invalid", "Unrecognized"),
    ("Error:", "Failure:"),
    ("not found", "does not exist"),
    ("Unauthorized", "Access denied"),
    ("Permission denied", "Insufficient privileges"),
]

# Contextual import lines that can be added (neutral, won't break anything)
EXTRA_IMPORT_LINES = [
    "import { resolve } from 'path';",
    "import { existsSync } from 'fs';",
    "import { format } from 'date-fns';",
    "import type { Config } from '../types.js';",
    "import { VERSION } from '../constants.js';",
    "import { isDebug } from '../lib/env.js';",
]


def get_file_path_variants(original_path: str) -> list[str]:
    """Get file path variants for a given path."""
    if original_path in FILE_PATH_VARIANTS:
        return FILE_PATH_VARIANTS[original_path]

    # Match by pattern
    for key, variants in FILE_PATH_VARIANTS.items():
        if key in original_path or original_path in key:
            return variants

    # Build variants based on the filename
    filename = original_path.split("/")[-1]
    base_variants = []

    if "commands" in original_path:
        for cmd in ["analyze.ts", "deploy.ts", "export.ts", "report.ts", "watch.ts", "sync.ts"]:
            if cmd not in original_path:
                base_variants.append(f"src/commands/{cmd}")
    elif "server" in original_path:
        for srv in ["api.ts", "handlers.ts", "middleware.ts", "controllers.ts"]:
            if srv not in original_path:
                base_variants.append(f"server/{srv}")
    elif "pages" in original_path:
        for pg in ["dashboard.tsx", "profile.tsx", "settings.tsx", "home.tsx", "login.tsx"]:
            if pg not in original_path:
                base_variants.append(f"client/src/pages/{pg}")
    elif "components" in original_path:
        for comp in ["modal.tsx", "form.tsx", "table.tsx", "card.tsx", "button.tsx"]:
            if comp not in original_path:
                base_variants.append(f"client/src/components/{comp}")

    return base_variants if base_variants else DEFAULT_PATH_VARIANTS[:5]


def apply_var_substitution(code: str, sub_set: dict) -> str:
    """Apply variable name substitutions consistently to code."""
    result = code
    for old_var, new_var in sub_set.items():
        # Word boundary replacement to avoid partial matches
        result = re.sub(r'\b' + re.escape(old_var) + r'\b', new_var, result)
    return result


def apply_function_substitution(code: str) -> tuple[str, bool]:
    """Apply a random function name substitution. Returns (new_code, was_changed)."""
    for func_name, variants in FUNCTION_NAME_VARIANTS.items():
        pattern = r'\b' + re.escape(func_name) + r'\b'
        if re.search(pattern, code):
            new_name = random.choice(variants)
            new_code = re.sub(pattern, new_name, code)
            return new_code, True
    return code, False


def apply_error_msg_substitution(code: str) -> tuple[str, bool]:
    """Apply a random error message substitution."""
    applicable = [(old, new) for old, new in ERROR_MSG_VARIANTS if old in code]
    if not applicable:
        return code, False
    old, new = random.choice(applicable)
    return code.replace(old, new, 1), True


def parse_user_message(user_content: str) -> tuple[str, str, str, str]:
    """Parse user message into (file_path, category, instruction, code)."""
    lines = user_content.split("\n")
    file_path = ""
    category = ""
    instruction = ""
    code_start = -1

    for i, line in enumerate(lines):
        if line.startswith("File: "):
            file_path = line[6:].strip()
        elif line.startswith("Category: "):
            category = line[10:].strip()
        elif line.startswith("Instruction: "):
            instruction = line[13:].strip()
        elif line.strip() == "Code to fix:":
            code_start = i + 1
            break

    code = "\n".join(lines[code_start:]) if code_start >= 0 else ""
    return file_path, category, instruction, code


def build_user_message(file_path: str, category: str, instruction: str, code: str) -> str:
    """Reconstruct a user message from components."""
    return f"File: {file_path}\nCategory: {category}\nInstruction: {instruction}\n\nCode to fix:\n{code}"


def extract_code_block(content: str) -> tuple[str, str, str]:
    """Extract code from a markdown code block. Returns (prefix, code, suffix)."""
    match = re.search(r'(```typescript\n)(.*?)(```)', content, re.DOTALL)
    if match:
        return match.group(1), match.group(2), match.group(3)
    return "", content, ""


def generate_variations(example: dict, num_variations: int = 4) -> list[dict]:
    """Generate augmented variations of a single example."""
    messages = example["messages"]
    system_msg = messages[0]
    user_content = messages[1]["content"]
    assistant_content = messages[2]["content"]

    file_path, category, instruction, user_code_block = parse_user_message(user_content)

    # Extract actual code from the code block
    u_prefix, user_code, u_suffix = extract_code_block(user_code_block)
    a_prefix, asst_code, a_suffix = extract_code_block(assistant_content)

    path_variants = get_file_path_variants(file_path)
    variations = []

    used_paths = set()
    used_paths.add(file_path)

    strategies = [
        "var_sub_0",
        "var_sub_1",
        "var_sub_2",
        "var_sub_3",
        "func_sub",
        "error_msg",
        "path_only",
        "add_import",
    ]
    random.shuffle(strategies)
    strategies = strategies[:num_variations]

    for strategy in strategies:
        new_user_code = user_code
        new_asst_code = asst_code
        new_path = file_path
        changed = False

        if strategy.startswith("var_sub_"):
            idx = int(strategy.split("_")[-1])
            sub_set = VAR_SUBSTITUTION_SETS[idx]
            new_user_code = apply_var_substitution(user_code, sub_set)
            new_asst_code = apply_var_substitution(asst_code, sub_set)
            changed = new_user_code != user_code or new_asst_code != asst_code

        elif strategy == "func_sub":
            new_user_code, cu = apply_function_substitution(user_code)
            new_asst_code, ca = apply_function_substitution(asst_code)
            changed = cu or ca

        elif strategy == "error_msg":
            new_user_code, cu = apply_error_msg_substitution(user_code)
            new_asst_code, ca = apply_error_msg_substitution(asst_code)
            changed = cu or ca

        elif strategy == "path_only":
            # Just change the file path
            available = [p for p in path_variants if p not in used_paths]
            if available:
                new_path = random.choice(available)
                used_paths.add(new_path)
                changed = True

        elif strategy == "add_import":
            # Add an extra import line to both user and assistant code
            extra = random.choice(EXTRA_IMPORT_LINES)
            if extra not in user_code and "import" in user_code:
                # Insert after first import block
                lines = user_code.split("\n")
                last_import = 0
                for i, line in enumerate(lines):
                    if line.strip().startswith("import "):
                        last_import = i
                if last_import > 0:
                    lines.insert(last_import + 1, extra)
                    new_user_code = "\n".join(lines)

                    a_lines = asst_code.split("\n")
                    a_last_import = 0
                    for i, line in enumerate(a_lines):
                        if line.strip().startswith("import "):
                            a_last_import = i
                    if a_last_import > 0:
                        a_lines.insert(a_last_import + 1, extra)
                        new_asst_code = "\n".join(a_lines)
                    changed = True

        # Also vary file path for non-path-only strategies
        if strategy != "path_only" and path_variants:
            available = [p for p in path_variants if p not in used_paths]
            if available:
                new_path = random.choice(available)
                used_paths.add(new_path)
                changed = True

        if not changed:
            # Force a path change at minimum
            available = [p for p in path_variants if p not in used_paths]
            if available:
                new_path = random.choice(available)
                used_paths.add(new_path)
            else:
                # Exhausted paths, use var sub as fallback
                sub_set = random.choice(VAR_SUBSTITUTION_SETS)
                new_user_code = apply_var_substitution(user_code, sub_set)
                new_asst_code = apply_var_substitution(asst_code, sub_set)

        # Reconstruct messages
        new_user_code_block = u_prefix + new_user_code + u_suffix
        new_asst_content = a_prefix + new_asst_code + a_suffix
        new_user_msg = build_user_message(new_path, category, instruction, new_user_code_block)

        variation = {
            "messages": [
                system_msg,
                {"role": "user", "content": new_user_msg},
                {"role": "assistant", "content": new_asst_content},
            ]
        }
        variations.append(variation)

    return variations


def main():
    # Load original examples
    originals = []
    with open(INPUT_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                originals.append(json.loads(line))

    print(f"Loaded {len(originals)} original examples")

    all_examples = list(originals)  # Start with originals

    for i, example in enumerate(originals):
        if i % 50 == 0 and i > 0:
            print(f"  Progress: processed {i}/{len(originals)} originals, {len(all_examples)} total so far")

        variations = generate_variations(example, num_variations=5)
        all_examples.extend(variations)

    print(f"Generated {len(all_examples)} total examples ({len(originals)} original + {len(all_examples) - len(originals)} augmented)")

    # Write output
    with open(OUTPUT_FILE, "w") as f:
        for ex in all_examples:
            f.write(json.dumps(ex) + "\n")

    print(f"Written to {OUTPUT_FILE}")
    print(f"DONE: augmented to {len(all_examples)} examples")


if __name__ == "__main__":
    random.seed(42)
    main()
