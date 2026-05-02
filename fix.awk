#!/usr/bin/awk
# Insert anti-hallucination warning at the beginning of the return statement in buildIssuePlanPrompt

# Find the function buildIssuePlanPrompt
/^export async function buildIssuePlanPrompt\(/ {
    in_function = 1
    print
    next
}

in_function {
    if (/^  return \(/) {
        # Print the warning line before the return
        print "    `⚠️  CRITICAL: Do NOT invent, guess, or hallucinate file paths. Work ONLY on the provided target path.\n` +"
    }
}

# Reset in_function when we hit the next function
/^export function buildSweepPrompt/ {
    in_function = 0
}

{ print }