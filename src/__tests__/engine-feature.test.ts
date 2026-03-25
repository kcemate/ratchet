import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseFeaturePlan, getReadySteps, isPlanComplete, renderFeaturePlanMarkdown, resolveSpec,
} from '../../src/core/engine-feature.js';
import { buildFeaturePlanPrompt, buildFeatureClickPrompt } from '../../src/core/agents/shell.js';
import type { FeaturePlan, FeatureStep } from '../../src/types.js';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ── parseFeaturePlan ────────────────────────────────────────────────────────

describe('parseFeaturePlan', () => {
  it('parses a valid JSON plan from clean output', () => {
    const json = JSON.stringify({
      spec: 'Add JWT authentication',
      steps: [
        { id: 1, description: 'Create JWT utility', files: ['src/auth/jwt.ts'],
          dependencies: [], status: 'pending' },
        { id: 2, description: 'Add auth middleware', files: ['src/middleware/auth.ts'],
          dependencies: [1], status: 'pending' },
      ],
      completedSteps: [],
      filesCreated: [],
      filesModified: [],
    });

    const plan = parseFeaturePlan(json);
    expect(plan).not.toBeNull();
    expect(plan!.spec).toBe('Add JWT authentication');
    expect(plan!.steps).toHaveLength(2);
    expect(plan!.steps[0]!.id).toBe(1);
    expect(plan!.steps[1]!.dependencies).toEqual([1]);
  });

  it('strips markdown code fences before parsing', () => {
    const json = `\`\`\`json
{
  "spec": "Add search feature",
  "steps": [{ "id": 1, "description": "Build search index", "files": [], "dependencies": [], "status": "pending" }],
  "completedSteps": [],
  "filesCreated": [],
  "filesModified": []
}
\`\`\``;

    const plan = parseFeaturePlan(json);
    expect(plan).not.toBeNull();
    expect(plan!.spec).toBe('Add search feature');
  });

  it('strips plain code fences before parsing', () => {
    const json = '```\n{"spec":"x","steps":[],"completedSteps":[],"filesCreated":[],"filesModified":[]}\n```';
    const plan = parseFeaturePlan(json);
    expect(plan).not.toBeNull();
  });

  it('extracts JSON from mixed output (prose + JSON)', () => {
    const output = `Here is the plan:\n\n` +
      `{"spec":"Auth","steps":[],"completedSteps":[],"filesCreated":[],"filesModified":[]}`;
    const plan = parseFeaturePlan(output);
    expect(plan).not.toBeNull();
    expect(plan!.spec).toBe('Auth');
  });

  it('returns null for output with no JSON object', () => {
    const plan = parseFeaturePlan('I cannot generate a plan right now.');
    expect(plan).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const plan = parseFeaturePlan('{invalid json}');
    expect(plan).toBeNull();
  });

  it('returns null if required fields are missing', () => {
    // Missing 'steps' field
    const plan = parseFeaturePlan('{"spec":"test","completedSteps":[],"filesCreated":[],"filesModified":[]}');
    expect(plan).toBeNull();
  });

  it('returns null if spec is not a string', () => {
    const plan = parseFeaturePlan('{"spec":123,"steps":[],"completedSteps":[],"filesCreated":[],"filesModified":[]}');
    expect(plan).toBeNull();
  });

  it('handles an empty steps array', () => {
    const plan = parseFeaturePlan(
      '{"spec":"Minimal","steps":[],"completedSteps":[],"filesCreated":[],"filesModified":[]}',
    );
    expect(plan).not.toBeNull();
    expect(plan!.steps).toHaveLength(0);
  });
});

// ── getReadySteps ───────────────────────────────────────────────────────────

describe('getReadySteps', () => {
  function makePlan(steps: FeatureStep[], completedSteps: number[] = []): FeaturePlan {
    return { spec: 'Test', steps, completedSteps, filesCreated: [], filesModified: [] };
  }

  it('returns steps with no dependencies when nothing is completed', () => {
    const steps: FeatureStep[] = [
      { id: 1, description: 'Step 1', files: [], dependencies: [], status: 'pending' },
      { id: 2, description: 'Step 2', files: [], dependencies: [1], status: 'pending' },
    ];
    const plan = makePlan(steps);
    const ready = getReadySteps(plan);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.id).toBe(1);
  });

  it('returns step 2 once step 1 is completed', () => {
    const steps: FeatureStep[] = [
      { id: 1, description: 'Step 1', files: [], dependencies: [], status: 'completed' },
      { id: 2, description: 'Step 2', files: [], dependencies: [1], status: 'pending' },
    ];
    const plan = makePlan(steps, [1]);
    const ready = getReadySteps(plan);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.id).toBe(2);
  });

  it('returns multiple steps when all their dependencies are met', () => {
    const steps: FeatureStep[] = [
      { id: 1, description: 'Step 1', files: [], dependencies: [], status: 'completed' },
      { id: 2, description: 'Step 2', files: [], dependencies: [1], status: 'pending' },
      { id: 3, description: 'Step 3', files: [], dependencies: [1], status: 'pending' },
    ];
    const plan = makePlan(steps, [1]);
    const ready = getReadySteps(plan);
    expect(ready).toHaveLength(2);
    const ids = ready.map(s => s.id);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
  });

  it('does not return already-completed steps', () => {
    const steps: FeatureStep[] = [
      { id: 1, description: 'Step 1', files: [], dependencies: [], status: 'completed' },
    ];
    const plan = makePlan(steps, [1]);
    const ready = getReadySteps(plan);
    expect(ready).toHaveLength(0);
  });

  it('does not return failed steps', () => {
    const steps: FeatureStep[] = [
      { id: 1, description: 'Step 1', files: [], dependencies: [], status: 'failed' },
    ];
    const plan = makePlan(steps);
    const ready = getReadySteps(plan);
    expect(ready).toHaveLength(0);
  });

  it('does not return in-progress steps', () => {
    const steps: FeatureStep[] = [
      { id: 1, description: 'Step 1', files: [], dependencies: [], status: 'in-progress' },
    ];
    const plan = makePlan(steps);
    const ready = getReadySteps(plan);
    expect(ready).toHaveLength(0);
  });

  it('returns nothing if all dependencies are unfulfilled', () => {
    const steps: FeatureStep[] = [
      { id: 1, description: 'Step 1', files: [], dependencies: [99], status: 'pending' },
    ];
    const plan = makePlan(steps);
    const ready = getReadySteps(plan);
    expect(ready).toHaveLength(0);
  });

  it('handles complex dependency chains', () => {
    const steps: FeatureStep[] = [
      { id: 1, description: 'A', files: [], dependencies: [], status: 'completed' },
      { id: 2, description: 'B', files: [], dependencies: [1], status: 'completed' },
      { id: 3, description: 'C', files: [], dependencies: [1, 2], status: 'pending' },
      { id: 4, description: 'D', files: [], dependencies: [3], status: 'pending' },
    ];
    const plan = makePlan(steps, [1, 2]);
    const ready = getReadySteps(plan);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.id).toBe(3);
  });
});

// ── isPlanComplete ──────────────────────────────────────────────────────────

describe('isPlanComplete', () => {
  it('returns true when all steps are completed', () => {
    const plan: FeaturePlan = {
      spec: 'Test',
      steps: [
        { id: 1, description: 'A', files: [], dependencies: [], status: 'completed' },
        { id: 2, description: 'B', files: [], dependencies: [], status: 'completed' },
      ],
      completedSteps: [1, 2],
      filesCreated: [],
      filesModified: [],
    };
    expect(isPlanComplete(plan)).toBe(true);
  });

  it('returns true when all steps are completed or failed', () => {
    const plan: FeaturePlan = {
      spec: 'Test',
      steps: [
        { id: 1, description: 'A', files: [], dependencies: [], status: 'completed' },
        { id: 2, description: 'B', files: [], dependencies: [], status: 'failed' },
      ],
      completedSteps: [1],
      filesCreated: [],
      filesModified: [],
    };
    expect(isPlanComplete(plan)).toBe(true);
  });

  it('returns false when any step is pending', () => {
    const plan: FeaturePlan = {
      spec: 'Test',
      steps: [
        { id: 1, description: 'A', files: [], dependencies: [], status: 'completed' },
        { id: 2, description: 'B', files: [], dependencies: [], status: 'pending' },
      ],
      completedSteps: [1],
      filesCreated: [],
      filesModified: [],
    };
    expect(isPlanComplete(plan)).toBe(false);
  });

  it('returns false when any step is in-progress', () => {
    const plan: FeaturePlan = {
      spec: 'Test',
      steps: [
        { id: 1, description: 'A', files: [], dependencies: [], status: 'in-progress' },
      ],
      completedSteps: [],
      filesCreated: [],
      filesModified: [],
    };
    expect(isPlanComplete(plan)).toBe(false);
  });

  it('returns true for an empty plan (no steps)', () => {
    const plan: FeaturePlan = {
      spec: 'Test',
      steps: [],
      completedSteps: [],
      filesCreated: [],
      filesModified: [],
    };
    expect(isPlanComplete(plan)).toBe(true);
  });
});

// ── renderFeaturePlanMarkdown ───────────────────────────────────────────────

describe('renderFeaturePlanMarkdown', () => {
  const plan: FeaturePlan = {
    spec: 'Add user authentication',
    steps: [
      { id: 1, description: 'Create JWT utility', files: ['src/auth/jwt.ts'], dependencies: [], status: 'completed' },
      { id: 2, description: 'Add middleware', files: ['src/middleware/auth.ts'], dependencies: [1], status: 'pending' },
    ],
    completedSteps: [1],
    filesCreated: ['src/auth/jwt.ts'],
    filesModified: ['src/app.ts'],
  };

  it('includes the target name in the heading', () => {
    const md = renderFeaturePlanMarkdown(plan, 'my-feature');
    expect(md).toContain('my-feature');
  });

  it('includes the spec text', () => {
    const md = renderFeaturePlanMarkdown(plan, 'my-feature');
    expect(md).toContain('Add user authentication');
  });

  it('shows completed step with ✅ icon', () => {
    const md = renderFeaturePlanMarkdown(plan, 'my-feature');
    expect(md).toContain('✅');
    expect(md).toContain('Create JWT utility');
  });

  it('shows pending step with ⬜ icon', () => {
    const md = renderFeaturePlanMarkdown(plan, 'my-feature');
    expect(md).toContain('⬜');
    expect(md).toContain('Add middleware');
  });

  it('lists files created', () => {
    const md = renderFeaturePlanMarkdown(plan, 'my-feature');
    expect(md).toContain('src/auth/jwt.ts');
  });

  it('lists files modified', () => {
    const md = renderFeaturePlanMarkdown(plan, 'my-feature');
    expect(md).toContain('src/app.ts');
  });

  it('shows progress percentage', () => {
    const md = renderFeaturePlanMarkdown(plan, 'my-feature');
    expect(md).toMatch(/50%/);
  });

  it('shows failed step with ❌ icon', () => {
    const failedPlan: FeaturePlan = {
      ...plan,
      steps: [{ id: 1, description: 'Failed step', files: [], dependencies: [], status: 'failed' }],
    };
    const md = renderFeaturePlanMarkdown(failedPlan, 'test');
    expect(md).toContain('❌');
  });
});

// ── resolveSpec ─────────────────────────────────────────────────────────────

describe('resolveSpec', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ratchet-spec-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns inline string as-is when not a file path', async () => {
    const spec = 'Add user authentication with JWT tokens';
    const result = await resolveSpec(spec);
    expect(result).toBe(spec);
  });

  it('reads file contents when a .md file path is provided', async () => {
    const specPath = join(tmpDir, 'auth.md');
    await writeFile(specPath, '# Auth Spec\n\nAdd JWT authentication.\n', 'utf-8');
    const result = await resolveSpec(specPath);
    expect(result).toBe('# Auth Spec\n\nAdd JWT authentication.');
  });

  it('reads file contents when a .txt file path is provided', async () => {
    const specPath = join(tmpDir, 'spec.txt');
    await writeFile(specPath, 'Build a search feature.', 'utf-8');
    const result = await resolveSpec(specPath);
    expect(result).toBe('Build a search feature.');
  });

  it('returns the string as-is when path-like string does not exist on disk', async () => {
    const nonExistentPath = join(tmpDir, 'nonexistent.md');
    const result = await resolveSpec(nonExistentPath);
    expect(result).toBe(nonExistentPath);
  });

  it('reads file when given a relative-looking path that exists', async () => {
    const specPath = join(tmpDir, 'feature.md');
    await writeFile(specPath, 'Feature spec content', 'utf-8');
    const result = await resolveSpec(specPath);
    expect(result).toBe('Feature spec content');
  });
});

// ── buildFeaturePlanPrompt ──────────────────────────────────────────────────

describe('buildFeaturePlanPrompt', () => {
  it('includes the spec in the prompt', () => {
    const prompt = buildFeaturePlanPrompt('Add JWT authentication', '/tmp');
    expect(prompt).toContain('Add JWT authentication');
  });

  it('includes JSON schema guidance', () => {
    const prompt = buildFeaturePlanPrompt('Build search', '/tmp');
    expect(prompt).toContain('"steps"');
    expect(prompt).toContain('"completedSteps"');
    expect(prompt).toContain('"dependencies"');
  });

  it('instructs agent not to make code changes', () => {
    const prompt = buildFeaturePlanPrompt('Build something', '/tmp');
    expect(prompt.toLowerCase()).toMatch(/do not|don't|no code|no files|not implement/i);
  });

  it('includes JSON output instruction', () => {
    const prompt = buildFeaturePlanPrompt('Build search', '/tmp');
    expect(prompt).toContain('JSON');
  });
});

// ── buildFeatureClickPrompt ─────────────────────────────────────────────────

describe('buildFeatureClickPrompt', () => {
  const plan: FeaturePlan = {
    spec: 'Add authentication system',
    steps: [
      { id: 1, description: 'Create JWT utility', files: ['src/auth/jwt.ts'], dependencies: [], status: 'completed' },
      { id: 2, description: 'Add auth middleware', files: ['src/middleware/auth.ts'],
        dependencies: [1], status: 'pending' },
      { id: 3, description: 'Update routes', files: ['src/routes.ts'],
        dependencies: [2], status: 'pending' },
    ],
    completedSteps: [1],
    filesCreated: ['src/auth/jwt.ts'],
    filesModified: [],
  };

  const step = plan.steps[1]!; // step 2

  it('includes the feature spec in the prompt', () => {
    const prompt = buildFeatureClickPrompt(step, plan, '/tmp');
    expect(prompt).toContain('Add authentication system');
  });

  it('includes the current step description', () => {
    const prompt = buildFeatureClickPrompt(step, plan, '/tmp');
    expect(prompt).toContain('Add auth middleware');
  });

  it('shows completed steps', () => {
    const prompt = buildFeatureClickPrompt(step, plan, '/tmp');
    expect(prompt).toContain('Create JWT utility');
  });

  it('shows remaining steps', () => {
    const prompt = buildFeatureClickPrompt(step, plan, '/tmp');
    expect(prompt).toContain('Update routes');
  });

  it('instructs agent to implement only the current step', () => {
    const prompt = buildFeatureClickPrompt(step, plan, '/tmp');
    expect(prompt).toContain('Step 2');
    expect(prompt.toLowerCase()).toMatch(/only|only.*step 2/i);
  });

  it('includes MODIFIED: output instruction', () => {
    const prompt = buildFeatureClickPrompt(step, plan, '/tmp');
    expect(prompt).toContain('MODIFIED:');
  });

  it('includes CREATED: output instruction', () => {
    const prompt = buildFeatureClickPrompt(step, plan, '/tmp');
    expect(prompt).toContain('CREATED:');
  });

  it('shows files created so far', () => {
    const prompt = buildFeatureClickPrompt(step, plan, '/tmp');
    expect(prompt).toContain('src/auth/jwt.ts');
  });

  it('handles empty completed steps gracefully', () => {
    const emptyPlan: FeaturePlan = { ...plan, completedSteps: [] };
    const firstStep = plan.steps[0]!;
    const prompt = buildFeatureClickPrompt(firstStep, emptyPlan, '/tmp');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});
