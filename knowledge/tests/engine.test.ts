import { describe, it, expect } from 'vitest';
import * as engine from './engine';

// Mock types for testing
type Category = {
  name: string;
  score: number;
  max: number;
  subcategories: { issuesFound: number }[];
};

type ScanResult = {
  categories: Category[];
};

type CategoryDelta = {
  name: string;
  beforeScore: number;
  afterScore: number;
  max: number;
  beforeIssues: number;
  afterIssues: number;
  issuesFixed: number;
  delta: number;
};

type CircuitBreakerState = {
  consecutiveFailures: number;
  currentStrategy: 'standard' | 'architect' | 'sweep';
  strategiesExhausted: string[];
  totalFailures: number;
  maxTotalFailures: number;
};

type Click = {
  id: string;
  result?: {
    land: {
      id: string;
      delta: number;
      issuesFixed?: number;
      description?: string;
    }[];
  };
};

type ClickEconomics = {
  clickId: string;
  backlogSizeBefore: number;
  backlogSizeAfter: number;
  issuesFixed: number;
  scoreDelta: number;
  zeroDeltaLands: number;
  positiveDeltaLands: number;
  negativeDeltaLands: number;
  totalLands: number;
  landed: any[];
};

type RatchetConfig = {
  captureBaseline?: boolean | 'always';
  testIsolation?: boolean;
  stopConditions?: {
    zeroDeltaLands?: number;
    negativeDeltaLands?: number;
    scoreImprovement?: number;
  };
};

describe('engine module', () => {
  describe('shouldSoftSkipSubcategory', () => {
    it('should return false when zeroDeltaLands < 2', () => {
      expect(engine.shouldSoftSkipSubcategory(0)).toBe(false);
      expect(engine.shouldSoftSkipSubcategory(1)).toBe(false);
    });

    it('should return true when zeroDeltaLands >= 2', () => {
      expect(engine.shouldSoftSkipSubcategory(2)).toBe(true);
      expect(engine.shouldSoftSkipSubcategory(3)).toBe(true);
    });
  });

  describe('shouldEscalateOnTotalZeroDelta', () => {
    it('should return false when totalZeroDeltaLands < 3', () => {
      expect(engine.shouldEscalateOnTotalZeroDelta(0)).toBe(false);
      expect(engine.shouldEscalateOnTotalZeroDelta(1)).toBe(false);
      expect(engine.shouldEscalateOnTotalZeroDelta(2)).toBe(false);
    });

    it('should return true when totalZeroDeltaLands >= 3', () => {
      expect(engine.shouldEscalateOnTotalZeroDelta(3)).toBe(true);
      expect(engine.shouldEscalateOnTotalZeroDelta(4)).toBe(true);
    });
  });

  describe('diffCategories', () => {
    it('should compute deltas between two scan results', () => {
      const before: ScanResult = {
        categories: [
          {
            name: 'security',
            score: 80,
            max: 100,
            subcategories: [{ issuesFound: 5 }, { issuesFound: 3 }],
          },
        ],
      };

      const after: ScanResult = {
        categories: [
          {
            name: 'security',
            score: 90,
            max: 100,
            subcategories: [{ issuesFound: 2 }, { issuesFound: 1 }],
          },
        ],
      };

      const deltas = engine.diffCategories(before, after);
      expect(deltas).toHaveLength(1);
      expect(deltas[0].name).toBe('security');
      expect(deltas[0].beforeScore).toBe(80);
      expect(deltas[0].afterScore).toBe(90);
      expect(deltas[0].delta).toBe(10);
      expect(deltas[0].beforeIssues).toBe(8);
      expect(deltas[0].afterIssues).toBe(3);
      expect(deltas[0].issuesFixed).toBe(5);
    });

    it('should handle categories that exist in only one scan', () => {
      const before: ScanResult = {
        categories: [
          {
            name: 'security',
            score: 80,
            max: 100,
            subcategories: [{ issuesFound: 5 }],
          },
        ],
      };

      const after: ScanResult = {
        categories: [
          {
            name: 'performance',
            score: 70,
            max: 100,
            subcategories: [{ issuesFound: 3 }],
          },
        ],
      };

      const deltas = engine.diffCategories(before, after);
      expect(deltas).toHaveLength(2);
      expect(deltas[0].name).toBe('security');
      expect(deltas[1].name).toBe('performance');
    });

    it('should handle empty subcategories gracefully', () => {
      const before: ScanResult = {
        categories: [
          {
            name: 'security',
            score: 80,
            max: 100,
            subcategories: [],
          },
        ],
      };

      const after: ScanResult = {
        categories: [
          {
            name: 'security',
            score: 90,
            max: 100,
            subcategories: [],
          },
        ],
      };

      const deltas = engine.diffCategories(before, after);
      expect(deltas[0].beforeIssues).toBe(0);
      expect(deltas[0].afterIssues).toBe(0);
      expect(deltas[0].issuesFixed).toBe(0);
    });
  });

  describe('shouldContinueClickLoop', () => {
    const baseCircuitBreaker: CircuitBreakerState = {
      consecutiveFailures: 0,
      currentStrategy: 'standard',
      strategiesExhausted: [],
      totalFailures: 0,
      maxTotalFailures: 5,
    };

    it('should return false when circuit breaker is tripped', () => {
      const cb = { ...baseCircuitBreaker, totalFailures: 5 };
      expect(engine.shouldContinueClickLoop(10, 0, 0, 100, 10, cb)).toBe(false);
    });

    it('should return false when max clicks reached', () => {
      expect(engine.shouldContinueClickLoop(10, 100, 0, 100, 10, baseCircuitBreaker)).toBe(false);
    });

    it('should return false when max scans reached', () => {
      expect(engine.shouldContinueClickLoop(10, 0, 10, 100, 10, baseCircuitBreaker)).toBe(false);
    });

    it('should return false when backlog is empty', () => {
      expect(engine.shouldContinueClickLoop(0, 0, 0, 100, 10, baseCircuitBreaker)).toBe(false);
    });

    it('should return true when conditions are met', () => {
      expect(engine.shouldContinueClickLoop(10, 0, 0, 100, 10, baseCircuitBreaker)).toBe(true);
    });
  });

  describe('circuit breaker functions', () => {
    describe('initCircuitBreaker', () => {
      it('should initialize with correct default values', () => {
        const cb = engine.initCircuitBreaker(3);
        expect(cb.consecutiveFailures).toBe(0);
        expect(cb.currentStrategy).toBe('standard');
        expect(cb.strategiesExhausted).toEqual([]);
        expect(cb.totalFailures).toBe(0);
        expect(cb.maxTotalFailures).toBe(3);
      });
    });

    describe('recordFailure', () => {
      it('should increment failure counters and track strategy', () => {
        const cb = engine.initCircuitBreaker(5);
        const updated = engine.recordFailure(cb, 'standard');
        expect(updated.consecutiveFailures).toBe(1);
        expect(updated.totalFailures).toBe(1);
        expect(updated.strategiesExhausted).toContain('standard');
      });

      it('should not duplicate strategies in exhausted list', () => {
        const cb = engine.initCircuitBreaker(5);
        const updated1 = engine.recordFailure(cb, 'standard');
        const updated2 = engine.recordFailure(updated1, 'standard');
        expect(updated2.strategiesExhausted).toEqual(['standard']);
      });
    });

    describe('recordSuccess', () => {
      it('should reset consecutive failures', () => {
        const cb = engine.initCircuitBreaker(5);
        cb.consecutiveFailures = 3;
        const updated = engine.recordSuccess(cb);
        expect(updated.consecutiveFailures).toBe(0);
      });
    });

    describe('isCircuitBreakerTripped', () => {
      it('should return false when below thresholds', () => {
        const cb = engine.initCircuitBreaker(5);
        cb.totalFailures = 2;
        cb.consecutiveFailures = 2;
        expect(engine.isCircuitBreakerTripped(cb)).toBe(false);
      });

      it('should return true when total failures exceed max', () => {
        const cb = engine.initCircuitBreaker(3);
        cb.totalFailures = 3;
        expect(engine.isCircuitBreakerTripped(cb)).toBe(true);
      });

      it('should return true when consecutive failures reach 3', () => {
        const cb = engine.initCircuitBreaker(5);
        cb.consecutiveFailures = 3;
        expect(engine.isCircuitBreakerTripped(cb)).toBe(true);
      });
    });

    describe('updateStrategy', () => {
      it('should update strategy and reset consecutive failures', () => {
        const cb = engine.initCircuitBreaker(5);
        cb.consecutiveFailures = 2;
        const updated = engine.updateStrategy(cb, 'architect');
        expect(updated.currentStrategy).toBe('architect');
        expect(updated.consecutiveFailures).toBe(0);
      });
    });

    describe('hasTriedStrategy', () => {
      it('should return true for exhausted strategies', () => {
        const cb = engine.initCircuitBreaker(5);
        cb.strategiesExhausted = ['standard', 'architect'];
        expect(engine.hasTriedStrategy(cb, 'standard')).toBe(true);
        expect(engine.hasTriedStrategy(cb, 'architect')).toBe(true);
      });

      it('should return false for non-exhausted strategies', () => {
        const cb = engine.initCircuitBreaker(5);
        cb.strategiesExhausted = ['standard'];
        expect(engine.hasTriedStrategy(cb, 'architect')).toBe(false);
      });
    });
  });

  describe('click economics functions', () => {
    const mockClick: Click = {
      id: 'test-click',
      result: {
        land: [
          { id: 'land1', delta: 0, issuesFixed: 0, description: 'No change' },
          { id: 'land2', delta: 5, issuesFixed: 2, description: 'Improvement' },
          { id: 'land3', delta: -3, issuesFixed: 0, description: 'Regression' },
        ],
      },
    };

    describe('buildClickEconomics', () => {
      it('should build correct economics object', () => {
        const economics = engine.buildClickEconomics(mockClick, 10, 7, 2, 5);
        expect(economics.clickId).toBe('test-click');
        expect(economics.backlogSizeBefore).toBe(10);
        expect(economics.backlogSizeAfter).toBe(7);
        expect(economics.issuesFixed).toBe(2);
        expect(economics.scoreDelta).toBe(5);
        expect(economics.zeroDeltaLands).toBe(1);
        expect(economics.positiveDeltaLands).toBe(1);
        expect(economics.negativeDeltaLands).toBe(1);
        expect(economics.totalLands).toBe(3);
      });

      it('should handle empty land array', () => {
        const emptyClick: Click = { id: 'empty-click', result: { land: [] } };
        const economics = engine.buildClickEconomics(emptyClick, 10, 10, 0, 0);
        expect(economics.zeroDeltaLands).toBe(0);
        expect(economics.positiveDeltaLands).toBe(0);
        expect(economics.negativeDeltaLands).toBe(0);
        expect(economics.totalLands).toBe(0);
      });
    });

    describe('hasSuccessfulLands', () => {
      it('should return true when there are positive delta lands', () => {
        const economics = engine.buildClickEconomics(mockClick, 10, 7, 2, 5);
        expect(engine.hasSuccessfulLands(economics)).toBe(true);
      });

      it('should return false when no positive delta lands', () => {
        const failingClick: Click = {
          id: 'failing-click',
          result: {
            land: [
              { id: 'land1', delta: 0 },
              { id: 'land2', delta: -2 },
            ],
          },
        };
        const economics = engine.buildClickEconomics(failingClick, 10, 10, 0, -2);
        expect(engine.hasSuccessfulLands(economics)).toBe(false);
      });
    });

    describe('shouldRetryClick', () => {
      it('should return false when click has successful lands', () => {
        const economics = engine.buildClickEconomics(mockClick, 10, 7, 2, 5);
        expect(engine.shouldRetryClick(economics, 2)).toBe(false);
      });

      it('should return true when retry ratio meets threshold', () => {
        const failingClick: Click = {
          id: 'failing-click',
          result: {
            land: [
              { id: 'land1', delta: 0 },
              { id: 'land2', delta: 0 },
              { id: 'land3', delta: -1 },
            ],
          },
        };
        const economics = engine.buildClickEconomics(failingClick, 10, 10, 0, -1);
        expect(engine.shouldRetryClick(economics, 2)).toBe(true);
      });

      it('should return false when retry ratio below threshold', () => {
        const failingClick: Click = {
          id: 'failing-click',
          result: {
            land: [
              { id: 'land1', delta: 0 },
            ],
          },
        };
        const economics = engine.buildClickEconomics(failingClick, 10, 10, 0, 0);
        expect(engine.shouldRetryClick(economics, 2)).toBe(false);
      });
    });
  });

  describe('safety functions', () => {
    describe('extractHighRiskChanges', () => {
      it('should extract high-risk categories with low scores and issues', () => {
        const scanResult: ScanResult = {
          categories: [
            {
              name: 'security',
              score: 0.4,
              max: 100,
              subcategories: [{ issuesFound: 5 }, { issuesFound: 3 }],
            },
            {
              name: 'performance',
              score: 0.8,
              max: 100,
              subcategories: [{ issuesFound: 2 }],
            },
          ],
        };

        const changes = engine.extractHighRiskChanges(scanResult);
        expect(changes).toHaveLength(1);
        expect(changes[0].category).toBe('security');
        expect(changes[0].riskLevel).toBe('high');
        expect(changes[0].issuesFound).toBe(8);
      });

      it('should return empty array when no high-risk categories', () => {
        const scanResult: ScanResult = {
          categories: [
            {
              name: 'security',
              score: 0.8,
              max: 100,
              subcategories: [{ issuesFound: 1 }],
            },
          ],
        };

        const changes = engine.extractHighRiskChanges(scanResult);
        expect(changes).toHaveLength(0);
      });
    });

    describe('hasHighRiskCategories', () => {
      it('should return true when high-risk categories exist', () => {
        const scanResult: ScanResult = {
          categories: [
            {
              name: 'security',
              score: 0.4,
              max: 100,
              subcategories: [{ issuesFound: 5 }],
            },
          ],
        };

        expect(engine.hasHighRiskCategories(scanResult)).toBe(true);
      });

      it('should return false when no high-risk categories', () => {
        const scanResult: ScanResult = {
          categories: [
            {
              name: 'security',
              score: 0.8,
              max: 100,
              subcategories: [{ issuesFound: 1 }],
            },
          ],
        };

        expect(engine.hasHighRiskCategories(scanResult)).toBe(false);
      });
    });
  });

  describe('run management functions', () => {
    const mockTarget = { repo: 'test-repo' };
    const mockConfig: RatchetConfig = { captureBaseline: true };

    describe('buildRatchetRun', () => {
      it('should build a run with correct default values', () => {
        const run = engine.buildRatchetRun(mockTarget, mockConfig);
        expect(run.id).toBeDefined();
        expect(run.target).toBe(mockTarget);
        expect(run.config).toBe(mockConfig);
        expect(run.status).toBe('running');
        expect(run.scans).toEqual([]);
        expect(run.clicks).toEqual([]);
        expect(run.backlog).toEqual([]);
        expect(run.finalResult).toBeNull();
        expect(run.startTime).toBeInstanceOf(Date);
      });
    });

    describe('shouldCaptureBaseline', () => {
      it('should return true on first scan when enabled', () => {
        const config: RatchetConfig = { captureBaseline: true };
        expect(engine.shouldCaptureBaseline(config, 0)).toBe(true);
      });

      it('should return true when always enabled', () => {
        const config: RatchetConfig = { captureBaseline: 'always' };
        expect(engine.shouldCaptureBaseline(config, 1)).toBe(true);
      });

      it('should return false when disabled', () => {
        const config: RatchetConfig = {};
        expect(engine.shouldCaptureBaseline(config, 0)).toBe(false);
      });

      it('should return false on non-first scan when not always', () => {
        const config: RatchetConfig = { captureBaseline: true };
        expect(engine.shouldCaptureBaseline(config, 1)).toBe(false);
      });
    });

    describe('shouldUseTestIsolation', () => {
      it('should return false when testIsolation disabled', () => {
        const config: RatchetConfig = {};
        expect(engine.shouldUseTestIsolation(config, 'testing')).toBe(false);
      });

      it('should return true when testIsolation enabled and in testing phase', () => {
        const config: RatchetConfig = { testIsolation: true };
        expect(engine.shouldUseTestIsolation(config, 'testing')).toBe(true);
      });

      it('should return false when not in testing phase', () => {
        const config: RatchetConfig = { testIsolation: true };
        expect(engine.shouldUseTestIsolation(config, 'building')).toBe(false);
      });
    });

    describe('stop condition functions', () => {
      const mockEconomics: ClickEconomics = {
        clickId: 'test',
        backlogSizeBefore: 10,
        backlogSizeAfter: 7,
        issuesFixed: 2,
        scoreDelta: 5,
        zeroDeltaLands: 3,
        positiveDeltaLands: 1,
        negativeDeltaLands: 2,
        totalLands: 6,
        landed: [],
      };

      describe('shouldStopAfterZeroDeltaLands', () => {
        it('should return false when config not set', () => {
          const config: RatchetConfig = {};
          expect(engine.shouldStopAfterZeroDeltaLands(config, mockEconomics)).toBe(false);
        });

        it('should return true when threshold met', () => {
          const config: RatchetConfig = { stopConditions: { zeroDeltaLands: 3 } };
          expect(engine.shouldStopAfterZeroDeltaLands(config, mockEconomics)).toBe(true);
        });

        it('should return false when threshold not met', () => {
          const config: RatchetConfig = { stopConditions: { zeroDeltaLands: 5 } };
          expect(engine.shouldStopAfterZeroDeltaLands(config, mockEconomics)).toBe(false);
        });
      });

      describe('shouldStopAfterNegativeDeltaLands', () => {
        it('should return false when config not set', () => {
          const config: RatchetConfig = {};
          expect(engine.shouldStopAfterNegativeDeltaLands(config, mockEconomics)).toBe(false);
        });

        it('should return true when threshold met', () => {
          const config: RatchetConfig = { stopConditions: { negativeDeltaLands: 2 } };
          expect(engine.shouldStopAfterNegativeDeltaLands(config, mockEconomics)).toBe(true);
        });

        it('should return false when threshold not met', () => {
          const config: RatchetConfig = { stopConditions: { negativeDeltaLands: 5 } };
          expect(engine.shouldStopAfterNegativeDeltaLands(config, mockEconomics)).toBe(false);
        });
      });

      describe('shouldStopAfterScoreImprovement', () => {
        it('should return false when config not set', () => {
          const config: RatchetConfig = {};
          expect(engine.shouldStopAfterScoreImprovement(config, mockEconomics)).toBe(false);
        });

        it('should return true when threshold met', () => {
          const config: RatchetConfig = { stopConditions: { scoreImprovement: 5 } };
          expect(engine.shouldStopAfterScoreImprovement(config, mockEconomics)).toBe(true);
        });

        it('should return false when threshold not met', () => {
          const config: RatchetConfig = { stopConditions: { scoreImprovement: 10 } };
          expect(engine.shouldStopAfterScoreImprovement(config, mockEconomics)).toBe(false);
        });
      });
    });
  });
});