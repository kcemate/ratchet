import { detectFrameworks } from '../framework-detector.js';
import { adjustScoreForFrameworks, getFrameworkProfile } from '../framework-profiles.js';

describe('Framework Detector', () => {
  it('should detect Express framework', () => {
    jest.mock('fs');
    const readFileSyncMock = jest.fn();
    readFileSyncMock.mockReturnValue(JSON.stringify({
      dependencies: { express: '^4.18.2', 'express-validator': '^6.15.0' }
    }));
    jest.mocked(require('fs').readFileSync).mockImplementation(readFileSyncMock);
    
    const frameworks = detectFrameworks('/fake/path');
    expect(frameworks).toHaveLength(1);
    expect(frameworks[0].name).toBe('express');
    expect(frameworks[0].category).toBe('web-framework');
  });

  it('should detect multiple frameworks', () => {
    jest.mock('fs');
    const readFileSyncMock = jest.fn();
    readFileSyncMock.mockReturnValue(JSON.stringify({
      dependencies: {
        express: '^4.18.2',
        prisma: '^5.0.0',
        passport: '^1.0.0',
      }
    }));
    jest.mocked(require('fs').readFileSync).mockImplementation(readFileSyncMock);
    
    const frameworks = detectFrameworks('/fake/path');
    expect(frameworks).toHaveLength(3);
    const names = frameworks.map(f => f.name).sort();
    expect(names).toEqual(['express', 'passport', 'prisma']);
  });

  it('should detect Prisma ORM', () => {
    jest.mock('fs');
    const readFileSyncMock = jest.fn();
    readFileSyncMock.mockReturnValue(JSON.stringify({
      dependencies: { prisma: '^5.0.0' }
    }));
    jest.mocked(require('fs').readFileSync).mockImplementation(readFileSyncMock);
    
    const frameworks = detectFrameworks('/fake/path');
    expect(frameworks).toHaveLength(1);
    expect(frameworks[0].name).toBe('prisma');
    expect(frameworks[0].category).toBe('orm');
  });

  it('should detect Next.js framework', () => {
    jest.mock('fs');
    const readFileSyncMock = jest.fn();
    readFileSyncMock.mockReturnValue(JSON.stringify({
      dependencies: { next: '^14.0.0' }
    }));
    jest.mocked(require('fs').readFileSync).mockImplementation(readFileSyncMock);
    
    const frameworks = detectFrameworks('/fake/path');
    expect(frameworks).toHaveLength(1);
    expect(frameworks[0].name).toBe('next');
    expect(frameworks[0].category).toBe('full-stack-framework');
  });

  it('should detect frameworks from devDependencies', () => {
    jest.mock('fs');
    const readFileSyncMock = jest.fn();
    readFileSyncMock.mockReturnValue(JSON.stringify({
      devDependencies: {
        '@nestjs/common': '^6.0.0',
        '@nestjs/core': '^6.0.0',
      }
    }));
    jest.mocked(require('fs').readFileSync).mockImplementation(readFileSyncMock);
    
    const frameworks = detectFrameworks('/fake/path');
    expect(frameworks).toHaveLength(1);
    expect(frameworks[0].name).toBe('nestjs');
  });

  it('should detect frameworks from peerDependencies', () => {
    jest.mock('fs');
    const readFileSyncMock = jest.fn();
    readFileSyncMock.mockReturnValue(JSON.stringify({
      peerDependencies: {
        fastify: '^4.0.0',
      }
    }));
    jest.mocked(require('fs').readFileSync).mockImplementation(readFileSyncMock);
    
    const frameworks = detectFrameworks('/fake/path');
    expect(frameworks).toHaveLength(1);
    expect(frameworks[0].name).toBe('fastify');
  });

  it('should not detect non-existent frameworks', () => {
    jest.mock('fs');
    const readFileSyncMock = jest.fn();
    readFileSyncMock.mockReturnValue(JSON.stringify({
      dependencies: {
        lodash: '^4.17.21',
        axios: '^1.6.0',
      }
    }));
    jest.mocked(require('fs').readFileSync).mockImplementation(readFileSyncMock);
    
    const frameworks = detectFrameworks('/fake/path');
    expect(frameworks).toHaveLength(0);
  });

  it('should handle empty package.json', () => {
    jest.mock('fs');
    const readFileSyncMock = jest.fn();
    readFileSyncMock.mockReturnValue(JSON.stringify({}));
    jest.mocked(require('fs').readFileSync).mockImplementation(readFileSyncMock);
    
    const frameworks = detectFrameworks('/fake/path');
    expect(frameworks).toHaveLength(0);
  });
});

describe('Framework Profiles', () => {
  it('should get profile for Prisma in Type Safety category', () => {
    const framework = { name: 'prisma', category: 'orm' };
    const profile = getFrameworkProfile(framework, 'Type Safety');
    expect(profile).toBeDefined();
    expect(profile?.name).toBe('prisma');
    expect(profile?.category).toBe('Type Safety');
    expect(profile?.weight).toBe(0.9);
  });

  it('should get profile for Express in Error Handling category', () => {
    const framework = { name: 'express', category: 'web-framework' };
    const profile = getFrameworkProfile(framework, 'Error Handling');
    expect(profile).toBeDefined();
    expect(profile?.weight).toBe(0.5);
  });

  it('should return undefined for non-existent profile', () => {
    const framework = { name: 'lodash', category: 'utils' };
    const profile = getFrameworkProfile(framework, 'Type Safety');
    expect(profile).toBeUndefined();
  });

  it('should adjust score for Prisma in Type Safety', () => {
    const frameworks = [{ name: 'prisma', category: 'orm' }];
    const adjusted = adjustScoreForFrameworks(frameworks, 'Type Safety', 10);
    expect(adjusted).toBeCloseTo(11.11, 2);
  });

  it('should not adjust score when no frameworks affect category', () => {
    const frameworks = [{ name: 'express', category: 'web-framework' }];
    const adjusted = adjustScoreForFrameworks(frameworks, 'Testing', 15);
    expect(adjusted).toBe(15);
  });

  it('should average weights when multiple frameworks affect category', () => {
    const frameworks = [
      { name: 'prisma', category: 'orm' },
      { name: 'typeorm', category: 'orm' },
    ];
    const adjusted = adjustScoreForFrameworks(frameworks, 'Type Safety', 10);
    expect(adjusted).toBeCloseTo(13.33, 2);
  });

  it('should apply adjustment to multiple categories', () => {
    const frameworks = [
      { name: 'next', category: 'full-stack-framework' },
    ];
    
    let adjusted = adjustScoreForFrameworks(frameworks, 'Error Handling', 5);
    expect(adjusted).toBeCloseTo(5.56, 2);
    
    adjusted = adjustScoreForFrameworks(frameworks, 'Performance', 3);
    expect(adjusted).toBeCloseTo(3.75, 2);
  });
});