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

  it('accepts profiles and per-check evidence metadata', () => {
    const config = {
      version: 1,
      profiles: {
        fast: ['typecheck'],
        release: ['typecheck', 'acceptance'],
      },
      checks: [
        { id: 'typecheck', kind: 'build', argv: ['npm', 'run', 'typecheck'] },
        {
          id: 'acceptance',
          kind: 'acceptance',
          argv: ['npm', 'run', 'test:e2e'],
          requirementIds: ['REQ-001'],
          acceptanceIds: ['AC-001'],
        },
      ],
    };
    expect(validateConfig(config)).toEqual(config);
  });

  it('rejects a profile that references an unknown check', () => {
    expect(() =>
      validateConfig({
        version: 1,
        profiles: { fast: ['missing'] },
        checks: [{ id: 'typecheck', argv: ['true'] }],
      }),
    ).toThrow(/unknown check/);
  });

  it('rejects a profile without any required check', () => {
    expect(() =>
      validateConfig({
        version: 1,
        profiles: { fast: ['optional'] },
        checks: [{ id: 'optional', argv: ['true'], required: false }],
      }),
    ).toThrow(/at least one required check/);
  });

  it('rejects an invalid check kind', () => {
    expect(() =>
      validateConfig({
        version: 1,
        checks: [{ id: 'a', argv: ['true'], kind: 'lint' }],
      }),
    ).toThrow(/kind/);
  });

  it('rejects duplicate requirement ids', () => {
    expect(() =>
      validateConfig({
        version: 1,
        checks: [
          {
            id: 'a',
            argv: ['true'],
            requirementIds: ['REQ-001', 'REQ-001'],
          },
        ],
      }),
    ).toThrow(/duplicate id/);
  });
});
