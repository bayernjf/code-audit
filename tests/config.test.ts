import { describe, expect, it } from 'vitest';
import { ConfigError, validateConfig } from '../src/config.js';

const valid = {
  version: 1,
  checks: [{ id: 'typecheck', argv: ['npm', 'run', 'typecheck'] }],
};

describe('validateConfig', () => {
  it('accepts a minimal valid config and preserves defaults as optional', () => {
    expect(validateConfig(valid)).toEqual(valid);
  });

  it('rejects an empty checks list', () => {
    expect(() => validateConfig({ version: 1, checks: [] })).toThrow(ConfigError);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      validateConfig({
        version: 1,
        checks: [
          { id: 'a', argv: ['true'] },
          { id: 'a', argv: ['true'] },
        ],
      }),
    ).toThrow(/duplicate check id/);
  });

  it('rejects an absolute cwd so checks stay inside the repo', () => {
    expect(() =>
      validateConfig({ version: 1, checks: [{ id: 'a', argv: ['true'], cwd: '/tmp' }] }),
    ).toThrow(/repo-relative/);
  });

  it('rejects a timeout outside 1..600000', () => {
    expect(() =>
      validateConfig({ version: 1, checks: [{ id: 'a', argv: ['true'], timeoutMs: 0 }] }),
    ).toThrow(/timeoutMs/);
  });

  it('rejects a non-array argv, which prevents shell-string configs', () => {
    expect(() =>
      validateConfig({ version: 1, checks: [{ id: 'a', argv: 'npm test' }] }),
    ).toThrow(/argv/);
  });
});
