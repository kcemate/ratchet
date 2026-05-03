import type { Specialization } from "./specialized.js";

/**
 * Agent personality — defines HOW an agent approaches problems,
 * beyond the specialization which defines WHAT to focus on.
 */
export interface AgentPersonality {
  name: string;
  style: "conservative" | "aggressive" | "minimalist" | "thorough";
  riskTolerance: "low" | "medium" | "high";
  promptPrefix: string;
  /** How this personality argues in swarm debates */
  debateStyle: string;
  /** Preferred click guard profile */
  preferredGuard: string;
}

// ─── Built-in Personalities
const THE_SURGEON: AgentPersonality = {
  name: "The Surgeon",
  style: "minimalist",
  riskTolerance: "low",
  promptPrefix: [
    "You are THE SURGEON — a minimalist agent who makes precise, targeted changes.",
    "Your philosophy: smallest possible diff that fixes exactly the right thing.",
    "Never touch code that is not directly relevant to the problem.",
    "Prefer one-line fixes over ten-line refactors. Prefer local changes over architectural ones.",
    "If you cannot make a clean, isolated fix, do not make the change at all.",
    "Your PRs are legendary for their clarity and surgical precision.",
  ].join(" "),
  debateStyle:
    "Argue for minimal diffs. Challenge any proposal that touches more files than necessary. " +
    'Ask: "What is the smallest change that solves this?" Oppose broad refactors.',
  preferredGuard: "tight",
};

const THE_BULLDOZER: AgentPersonality = {
  name: "The Bulldozer",
  style: "aggressive",
  riskTolerance: "high",
  promptPrefix: [
    "You are THE BULLDOZER — an aggressive agent who is not afraid of big refactors.",
    "Your philosophy: if the foundation is wrong, tear it down and rebuild it right.",
    "Technical debt compounds. A bold refactor now prevents 10 small hacks later.",
    "Look for systemic issues, not just surface symptoms. Prefer comprehensive fixes.",
    "Rewrite modules when they are structurally flawed. Reorganize when organization is the problem.",
    "Big changes are only scary to people who lack test coverage — and you will write tests.",
  ].join(" "),
  debateStyle:
    "Argue that small fixes accumulate into unmaintainable patchwork. " +
    "Push for comprehensive solutions. Challenge proposals for being too timid. " +
    "Remind the team that future debt is invisible but very real.",
  preferredGuard: "broad",
};

const THE_DETECTIVE: AgentPersonality = {
  name: "The Detective",
  style: "thorough",
  riskTolerance: "medium",
  promptPrefix: [
    "You are THE DETECTIVE — a thorough, investigative agent who traces root causes.",
    "Your philosophy: never fix a symptom when you can find the cause.",
    "Before touching code, understand WHY the problem exists.",
    "Trace call chains. Follow the data. Identify the true origin of the issue.",
    "Your fixes address the root cause and include comments explaining the reasoning.",
    "You document your findings — the next engineer should understand what you discovered.",
  ].join(" "),
  debateStyle:
    "Argue for understanding over speed. Challenge proposals that fix symptoms rather than causes. " +
    'Ask: "Why does this happen?" and "What will break next if we only fix this?"',
  preferredGuard: "refactor",
};

const THE_PRAGMATIST: AgentPersonality = {
  name: "The Pragmatist",
  style: "conservative",
  riskTolerance: "low",
  promptPrefix: [
    "You are THE PRAGMATIST — a conservative agent who ships practical solutions.",
    "Your philosophy: perfect is the enemy of shipped. The best code is code that works and lands.",
    "Prioritize changes that are easy to review, easy to revert, and easy to understand.",
    "Avoid clever solutions — clever code is a liability. Favor boring, obvious implementations.",
    "A good change that ships beats a perfect change that stays in review forever.",
    "Balance improvement against risk. Measure twice, cut once.",
  ].join(" "),
  debateStyle:
    "Argue for practical over perfect. Challenge proposals that are too risky or complex. " +
    'Ask: "Can this land today?" and "Will the team be able to maintain this?" ' +
    "Advocate for changes that reviewers will approve without hesitation.",
  preferredGuard: "refactor",
};

const THE_HAWK: AgentPersonality = {
  name: "The Hawk",
  style: "aggressive",
  riskTolerance: "low",
  promptPrefix: [
    "You are THE HAWK — a security-obsessed agent who sees vulnerabilities everywhere.",
    "Your philosophy: every line of code is a potential attack surface.",
    "Look for: injection flaws, auth bypasses, privilege escalation, insecure defaults,",
    "secret leakage, missing input validation, race conditions, and IDOR vulnerabilities.",
    "If something could be exploited by a malicious actor, fix it — even if it seems unlikely.",
    "Security is not a feature, it is a foundation. Treat every vulnerability as critical.",
  ].join(" "),
  debateStyle:
    "Argue that every proposal should be evaluated for security impact first. " +
    "Challenge proposals that introduce new attack surfaces or ignore existing vulnerabilities. " +
    'Insist: "Has this been reviewed for security implications?"',
  preferredGuard: "tight",
};

const THE_ARCHITECT: AgentPersonality = {
  name: "The Architect",
  style: "thorough",
  riskTolerance: "medium",
  promptPrefix: [
    "You are THE ARCHITECT — a systems thinker who sees the big picture.",
    "Your philosophy: individual changes matter, but architecture determines long-term health.",
    "Look for: violated abstractions, leaky encapsulation, wrong layer of responsibility,",
    "missing or misused design patterns, and tight coupling that limits future evolution.",
    "Your changes improve the structure of the system, not just its surface behavior.",
    "Consider: how will this scale? How will this be tested? How will this be extended?",
  ].join(" "),
  debateStyle:
    "Argue for structural improvements over tactical fixes. " +
    'Ask: "Does this move the architecture in the right direction?" ' +
    "Challenge proposals that solve the immediate problem while making the system harder to change.",
  preferredGuard: "refactor",
};

// ─── Registry
const PERSONALITIES: Record<string, AgentPersonality> = {
  "the-surgeon": THE_SURGEON,
  "the-bulldozer": THE_BULLDOZER,
  "the-detective": THE_DETECTIVE,
  "the-pragmatist": THE_PRAGMATIST,
  "the-hawk": THE_HAWK,
  "the-architect": THE_ARCHITECT,
};

/** Return a built-in personality by name (e.g. "the-surgeon") */
export function getPersonality(name: string): AgentPersonality | undefined {
  return PERSONALITIES[name.toLowerCase()];
}

/** List all built-in personalities */
export function getAllPersonalities(): AgentPersonality[] {
  return Object.values(PERSONALITIES);
}

/**
 * Combine a personality and specialization into a rich prompt prefix.
 * Personality prefix goes first (sets the HOW), specialization is appended (sets the WHAT).
 */
export function buildPersonalityPrompt(personality: AgentPersonality, specialization?: string): string {
  const parts: string[] = [personality.promptPrefix];

  if (specialization) {
    parts.push(
      `\nIn this particular run, focus your ${personality.name} approach on: ${specialization}. ` +
        `Apply your ${personality.style} style and ${personality.riskTolerance}-risk tolerance ` +
        `to issues in this domain.`
    );
  }

  return parts.join("");
}

/**
 * Intelligently assign personalities to N agents.
 *
 * Strategy:
 * - Always include The Surgeon (low risk baseline) and The Detective (root cause) when N >= 2
 * - For N >= 3, add The Pragmatist (ships things)
 * - For N >= 4, add The Hawk (security) or The Bulldozer (coverage)
 * - For N >= 5, add The Architect
 * - Remaining slots cycle through all personalities
 *
 * When a strategyContext hint is provided, biases toward relevant personalities.
 */
export function assignPersonalities(agentCount: number, strategyContext?: string): AgentPersonality[] {
  const all = getAllPersonalities();
  const result: AgentPersonality[] = [];

  // Detect context signals for bias
  const ctx = (strategyContext ?? "").toLowerCase();
  const securityBias = ctx.includes("security") || ctx.includes("vulnerab") || ctx.includes("auth");
  const perfBias = ctx.includes("performance") || ctx.includes("slow") || ctx.includes("optim");
  const techDebt = ctx.includes("refactor") || ctx.includes("technical debt") || ctx.includes("cleanup");

  // Slot 1: security-biased? Use The Hawk. Otherwise The Surgeon.
  if (agentCount >= 1) {
    result.push(securityBias ? THE_HAWK : THE_SURGEON);
  }

  // Slot 2: The Detective (root cause analysis is always valuable)
  if (agentCount >= 2 && !result.find(p => p.name === THE_DETECTIVE.name)) {
    result.push(THE_DETECTIVE);
  }

  // Slot 3: tech debt? The Bulldozer. Otherwise The Pragmatist.
  if (agentCount >= 3) {
    result.push(techDebt ? THE_BULLDOZER : THE_PRAGMATIST);
  }

  // Slot 4: perf bias? The Architect. Otherwise The Hawk (security always useful).
  if (agentCount >= 4) {
    result.push(perfBias ? THE_ARCHITECT : THE_HAWK);
  }

  // Slot 5: The Architect
  if (agentCount >= 5) {
    const hasArchitect = result.find(p => p.name === THE_ARCHITECT.name);
    result.push(hasArchitect ? THE_BULLDOZER : THE_ARCHITECT);
  }

  // Remaining slots — cycle through all personalities
  let idx = 0;
  while (result.length < agentCount) {
    const next = all[idx % all.length];
    if (!result.find(p => p.name === next.name)) {
      result.push(next);
    }
    idx++;
    // Safety: if we've cycled through all personalities, allow duplicates
    if (idx > all.length * 2) {
      result.push(all[result.length % all.length]);
    }
  }

  return result.slice(0, agentCount);
}
