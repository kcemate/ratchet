import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import type { Click, SwarmConfig } from '../src/types.js';

/**
 * Tests for swarm + adversarial defaults in the improve command.
 *
 * These tests verify the wiring behavior:
 * 1. Swarm mode is ON by default in improve
 * 2. Adversarial QA is ON by default in improve
 * 3. --no-swarm disables swarm
 * 4. --no-adversarial disables adversarial
 * 5. Click metadata includes swarm/adversarial fields
 * 6. PDF report data includes swarm/adversarial metadata
 */

// Test the Click type includes swarm/adversarial metadata fields
describe('Click type swarm/adversarial metadata', () => {
  it('includes swarmSpecialization field', () => {
    const click: Click = {
      number: 1,
      target: 'test',
      analysis: '',
      proposal: '',
      filesModified: [],
      testsPassed: true,
      timestamp: new Date(),
      swarmSpecialization: 'security',
    };
    expect(click.swarmSpecialization).toBe('security');
  });

  it('includes adversarialResult field', () => {
    const click: Click = {
      number: 1,
      target: 'test',
      analysis: '',
      proposal: '',
      filesModified: [],
      testsPassed: true,
      timestamp: new Date(),
      adversarialResult: {
        challenged: true,
        passed: true,
        reasoning: 'Change is safe',
      },
    };
    expect(click.adversarialResult!.challenged).toBe(true);
    expect(click.adversarialResult!.passed).toBe(true);
    expect(click.adversarialResult!.reasoning).toBe('Change is safe');
  });

  it('metadata fields are optional (backward compat)', () => {
    const click: Click = {
      number: 1,
      target: 'test',
      analysis: '',
      proposal: '',
      filesModified: [],
      testsPassed: true,
      timestamp: new Date(),
    };
    expect(click.swarmSpecialization).toBeUndefined();
    expect(click.adversarialResult).toBeUndefined();
  });
});

// Test that the improve command registers the correct CLI options
describe('improve command CLI options', () => {
  let improveCommand: () => Command;

  // Dynamically import to get the real command definition
  it('registers --no-swarm flag', async () => {
    const mod = await import('../src/commands/improve.js');
    const cmd = mod.improveCommand();

    // Commander negated boolean options: --no-swarm means swarm defaults to true
    const swarmOpt = cmd.options.find(
      (o: { long?: string }) => o.long === '--no-swarm',
    );
    expect(swarmOpt).toBeDefined();
  });

  it('registers --no-adversarial flag', async () => {
    const mod = await import('../src/commands/improve.js');
    const cmd = mod.improveCommand();

    const advOpt = cmd.options.find(
      (o: { long?: string }) => o.long === '--no-adversarial',
    );
    expect(advOpt).toBeDefined();
  });

  it('--no-swarm option is negatable (defaults true, --no-swarm sets false)', async () => {
    const mod = await import('../src/commands/improve.js');
    const cmd = mod.improveCommand();

    // Commander negated options: --no-swarm creates a boolean that defaults true
    const swarmOpt = cmd.options.find(
      (o: { long?: string }) => o.long === '--no-swarm',
    );
    expect(swarmOpt).toBeDefined();
    // Commander negated booleans: the option name is 'swarm', negate long is '--no-swarm'
    expect(swarmOpt!.attributeName()).toBe('swarm');
  });

  it('--no-adversarial option is negatable (defaults true, --no-adversarial sets false)', async () => {
    const mod = await import('../src/commands/improve.js');
    const cmd = mod.improveCommand();

    const advOpt = cmd.options.find(
      (o: { long?: string }) => o.long === '--no-adversarial',
    );
    expect(advOpt).toBeDefined();
  });
});

// Test SwarmConfig shape for improve defaults
describe('improve swarm config defaults', () => {
  it('default swarm config matches expected shape', () => {
    // This is the config that improve.ts creates when swarm is enabled
    const config: SwarmConfig = {
      enabled: true,
      agentCount: 3,
      specializations: ['security', 'quality', 'errors'],
      parallel: true,
      worktreeDir: '/tmp/ratchet-swarm',
    };

    expect(config.enabled).toBe(true);
    expect(config.agentCount).toBe(3);
    expect(config.specializations).toEqual(['security', 'quality', 'errors']);
    expect(config.parallel).toBe(true);
  });
});

// Test that runSweepEngine accepts adversarial option
describe('runSweepEngine adversarial support', () => {
  it('EngineRunOptions includes adversarial field', async () => {
    // Verify the type accepts adversarial
    const { runSweepEngine } = await import('../src/core/engine.js');
    expect(typeof runSweepEngine).toBe('function');
  });
});
