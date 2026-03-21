import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadLicense,
  saveLicense,
  clearLicense,
  requireLicense,
  isGatedCommand,
  isProCommand,
  getLicensePath,
  type LicenseData,
} from '../core/license.js';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

vi.mock('chalk', () => ({
  default: {
    red: (s: string) => s,
    dim: (s: string) => s,
    cyan: (s: string) => s,
    bold: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // RATCHET_DEV and RATCHET_LICENSE_URL are undefined by default
});

afterEach(() => {
  vi.restoreAllMocks();
});

const validLicense: LicenseData = {
  key: 'rkt_test_abc123',
  email: 'test@example.com',
  tier: 'pro',
  cyclesRemaining: 50,
  cyclesTotal: 100,
  validatedAt: new Date().toISOString(),
};

describe('loadLicense', () => {
  it('returns null when license file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadLicense()).toBeNull();
  });

  it('returns null when file content is invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not json');
    expect(loadLicense()).toBeNull();
  });

  it('returns parsed license data when valid', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validLicense));
    const license = loadLicense();
    expect(license).not.toBeNull();
    expect(license!.key).toBe('rkt_test_abc123');
    expect(license!.tier).toBe('pro');
  });

  it('returns null on filesystem error', () => {
    mockExistsSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    expect(loadLicense()).toBeNull();
  });
});

describe('saveLicense', () => {
  it('creates the .ratchet directory if it does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    saveLicense(validLicense);
    expect(mockMkdirSync).toHaveBeenCalledWith('/home/testuser/.ratchet', { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it('writes license JSON to license file', () => {
    mockExistsSync.mockReturnValue(true);
    saveLicense(validLicense);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/home/testuser/.ratchet/license.json',
      JSON.stringify(validLicense, null, 2),
    );
  });
});

describe('clearLicense', () => {
  it('returns true when file existed and was cleared', () => {
    mockExistsSync.mockReturnValue(true);
    expect(clearLicense()).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledWith('/home/testuser/.ratchet/license.json', '');
  });

  it('returns false when file did not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(clearLicense()).toBe(false);
  });

  it('returns false on filesystem error', () => {
    mockExistsSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    expect(clearLicense()).toBe(false);
  });
});

describe('isGatedCommand', () => {
  it('returns true for torque', () => {
    expect(isGatedCommand('torque')).toBe(true);
  });

  it('returns true for improve', () => {
    expect(isGatedCommand('improve')).toBe(true);
  });

  it('returns false for scan', () => {
    expect(isGatedCommand('scan')).toBe(false);
  });

  it('returns false for vision', () => {
    expect(isGatedCommand('vision')).toBe(false);
  });

  it('returns false for build', () => {
    expect(isGatedCommand('build')).toBe(false);
  });

  it('returns false for status', () => {
    expect(isGatedCommand('status')).toBe(false);
  });
});

describe('isProCommand', () => {
  it('returns true for torque', () => {
    expect(isProCommand('torque')).toBe(true);
  });

  it('returns false for improve', () => {
    expect(isProCommand('improve')).toBe(false);
  });

  it('returns false for scan', () => {
    expect(isProCommand('scan')).toBe(false);
  });
});

describe('getLicensePath', () => {
  it('returns the license file path', () => {
    expect(getLicensePath()).toContain('license.json');
  });
});

describe('requireLicense — RATCHET_DEV bypass', () => {
  it('returns enterprise license when RATCHET_DEV=1', () => {
    vi.stubEnv('RATCHET_DEV', '1');
    try {
      const license = requireLicense('torque');
      expect(license.key).toBe('dev');
      expect(license.tier).toBe('enterprise');
    } finally {
      vi.stubEnv('RATCHET_DEV', '');
    }
  });
});

describe('requireLicense — no license file', () => {
  it('exits with error for torque when no license', () => {
    mockExistsSync.mockReturnValue(false);
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => requireLicense('torque')).toThrow('process.exit');
    expect(exitMock).toHaveBeenCalledWith(1);
    consoleErrorMock.mockRestore();
    exitMock.mockRestore();
  });

  it('exits with error for improve when no license', () => {
    mockExistsSync.mockReturnValue(false);
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => requireLicense('improve')).toThrow('process.exit');
    expect(exitMock).toHaveBeenCalledWith(1);
    consoleErrorMock.mockRestore();
    exitMock.mockRestore();
  });
});

describe('requireLicense — with license but wrong tier', () => {
  it('exits when pro command but tier is builder', () => {
    const builderLicense: LicenseData = { ...validLicense, tier: 'builder' };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(builderLicense));

    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => requireLicense('torque')).toThrow('process.exit');
    expect(exitMock).toHaveBeenCalledWith(1);
    consoleErrorMock.mockRestore();
    exitMock.mockRestore();
  });

  it('exits when pro command but tier is free', () => {
    const freeLicense: LicenseData = { ...validLicense, tier: 'builder' };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(freeLicense));

    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => requireLicense('torque')).toThrow('process.exit');
    consoleErrorMock.mockRestore();
    exitMock.mockRestore();
  });

  it('does not exit for torque when tier is pro', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validLicense));
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    expect(() => requireLicense('torque')).not.toThrow();
    exitMock.mockRestore();
  });

  it('does not exit for torque when tier is team', () => {
    const teamLicense: LicenseData = { ...validLicense, tier: 'team' };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(teamLicense));
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    expect(() => requireLicense('torque')).not.toThrow();
    exitMock.mockRestore();
  });

  it('does not exit for torque when tier is enterprise', () => {
    const entLicense: LicenseData = { ...validLicense, tier: 'enterprise' };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(entLicense));
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    expect(() => requireLicense('torque')).not.toThrow();
    exitMock.mockRestore();
  });
});

describe('requireLicense — expiration', () => {
  it('exits when license is expired', () => {
    const expiredLicense: LicenseData = {
      ...validLicense,
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(expiredLicense));

    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => requireLicense('torque')).toThrow('process.exit');
    expect(exitMock).toHaveBeenCalledWith(1);
    consoleErrorMock.mockRestore();
    exitMock.mockRestore();
  });

  it('does not exit when license has no expiresAt', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validLicense));
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    expect(() => requireLicense('torque')).not.toThrow();
    exitMock.mockRestore();
  });

  it('does not exit when license expires in the future', () => {
    const futureLicense: LicenseData = {
      ...validLicense,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(futureLicense));
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    expect(() => requireLicense('torque')).not.toThrow();
    exitMock.mockRestore();
  });
});

describe('requireLicense — ungated commands', () => {
  it('returns null for ungated commands (scan)', () => {
    const result = requireLicense('scan');
    expect(result).toBeNull();
  });

  it('returns null for ungated commands (vision)', () => {
    expect(requireLicense('vision')).toBeNull();
  });

  it('returns null for ungated commands (build)', () => {
    expect(requireLicense('build')).toBeNull();
  });
});
