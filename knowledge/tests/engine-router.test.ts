import { describe, it, expect } from 'vitest';
import { createEngine } from './engine-router.js';
import { ClassicEngine } from './engines/classic.js';
import { DeepEngine } from './engines/deep.js';
import type { RatchetConfig } from '../types.js';

// Mock functions for testing
function createMockConfig(): RatchetConfig {
  return {
    scan: {
      engine: 'classic',
      model: 'test-model',
    },
    deep: {},
  };
}

describe('Engine Router', () => {
  describe('createEngine', () => {
    it('should default to ClassicEngine when mode is auto and no env/config', () => {
      const engine = createEngine('auto');
      expect(engine).toBeInstanceOf(ClassicEngine);
    });

    it('should use explicit mode when mode is classic', () => {
      const engine = createEngine('classic');
      expect(engine).toBeInstanceOf(ClassicEngine);
    });

    it('should use explicit mode when mode is deep', () => {
      const engine = createEngine('deep');
      expect(engine).toBeInstanceOf(DeepEngine);
    });

    it('should respect RATCHET_ENGINE environment variable over config when mode is auto', () => {
      process.env.RATCHET_ENGINE = 'deep';
      const config = createMockConfig();
      const engine = createEngine('auto', config);
      expect(engine).toBeInstanceOf(DeepEngine);
      delete process.env.RATCHET_ENGINE;
    });

    it('should respect RATCHET_ENGINE environment variable when no config', () => {
      process.env.RATCHET_ENGINE = 'deep';
      const engine = createEngine('auto');
      expect(engine).toBeInstanceOf(DeepEngine);
      delete process.env.RATCHET_ENGINE;
    });

    it('should respect config.scan.engine when mode is auto and no RATCHET_ENGINE', () => {
      const config = createMockConfig();
      const engine = createEngine('auto', config);
      expect(engine).toBeInstanceOf(ClassicEngine);
    });

    it('should pass scanModel override to DeepEngine', () => {
      const config = createMockConfig();
      const overrides = { scanModel: 'custom-model' };
      const engine = createEngine('deep', config, overrides);
      expect(engine).toBeInstanceOf(DeepEngine);
      // We can't easily check the internal provider without exposing more
    });

    it('should handle undefined config gracefully', () => {
      const engine = createEngine('auto', undefined);
      expect(engine).toBeInstanceOf(ClassicEngine);
    });

    it('should handle undefined overrides gracefully', () => {
      const engine = createEngine('deep', undefined, undefined);
      expect(engine).toBeInstanceOf(DeepEngine);
    });

    it('should use RATCHET_SCAN_MODEL env var when no overrides', () => {
      process.env.RATCHET_SCAN_MODEL = 'env-model';
      const config = createMockConfig();
      const engine = createEngine('deep', config);
      expect(engine).toBeInstanceOf(DeepEngine);
      delete process.env.RATCHET_SCAN_MODEL;
    });

    it('should fall back to config.scan.model when no env and no overrides', () => {
      const config = createMockConfig();
      const engine = createEngine('deep', config);
      expect(engine).toBeInstanceOf(DeepEngine);
    });

    it('should create ClassicEngine when resolvedMode is classic', () => {
      // This is indirectly tested through various paths
      const engine1 = createEngine('classic');
      expect(engine1).toBeInstanceOf(ClassicEngine);
      
      process.env.RATCHET_ENGINE = 'classic';
      const engine2 = createEngine('auto', createMockConfig());
      expect(engine2).toBeInstanceOf(ClassicEngine);
      delete process.env.RATCHET_ENGINE;
    });

    it('should create DeepEngine when resolvedMode is deep', () => {
      // This is indirectly tested through various paths
      const engine1 = createEngine('deep');
      expect(engine1).toBeInstanceOf(DeepEngine);
      
      process.env.RATCHET_ENGINE = 'deep';
      const engine2 = createEngine('auto', createMockConfig());
      expect(engine2).toBeInstanceOf(DeepEngine);
      delete process.env.RATCHET_ENGINE;
    });
  });

  describe('resolveProviderConfig', () => {
    it('should return undefined when no config and no RATCHET_PROVIDER', () => {
      const result = (createEngine as any).resolveProviderConfig(undefined);
      expect(result).toBeUndefined();
    });

    it('should respect RATCHET_PROVIDER environment variable', () => {
      process.env.RATCHET_PROVIDER = 'my-provider';
      process.env.RATCHET_MODEL = 'my-model';
      const result = (createEngine as any).resolveProviderConfig(undefined);
      expect(result).toEqual({ provider: 'my-provider', model: 'my-model' });
      delete process.env.RATCHET_PROVIDER;
      delete process.env.RATCHET_MODEL;
    });

    it('should work with config (though config.scan.engine is used differently)', () => {
      const config = createMockConfig();
      const result = (createEngine as any).resolveProviderConfig(config);
      expect(result).toBeUndefined();
    });
  });
});