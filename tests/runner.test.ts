import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { runAudit } from '../src/runner.js';

const tempDirs: string[] = [];

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'code-audit-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runAudit', () => {
  it('runs a passing check, writes report.json and captures stdout', async () => {
    const repo = await tempRepo();
    await writeFile(
      join(repo, 'audit.config.json'),
      JSON.stringify({
        version: 1,
        checks: [{ id: 'ok', argv: [process.execPath, '-e', 'console.log("hello audit")'] }],
      }),
    );

    const report = await runAudit({
      repoPath: repo,
      configPath: join(repo, 'audit.config.json'),
      outDir: join(repo, '.code-audit'),
    });

    expect(report.overall).toBe('passed');
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.status).toBe('passed');
    expect(report.checks[0]?.exitCode).toBe(0);

    const json = JSON.parse(await readFile(join(repo, '.code-audit', 'report.json'), 'utf8')) as {
      overall: string;
    };
    expect(json.overall).toBe('passed');
    const stdout = await readFile(join(repo, '.code-audit', 'checks', 'ok.stdout.log'), 'utf8');
    expect(stdout).toContain('hello audit');

    const sarif = JSON.parse(await readFile(join(repo, '.code-audit', 'report.sarif'), 'utf8')) as {
      version: string;
      runs: { results: unknown[] }[];
    };
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.results).toEqual([]);
  });

  it('marks a required failure as failed and keeps the evidence files', async () => {
    const repo = await tempRepo();
    await writeFile(
      join(repo, 'audit.config.json'),
      JSON.stringify({
        version: 1,
        checks: [{ id: 'fail', argv: [process.execPath, '-e', 'process.exit(1)'] }],
      }),
    );

    const report = await runAudit({
      repoPath: repo,
      configPath: join(repo, 'audit.config.json'),
      outDir: join(repo, '.code-audit'),
    });

    expect(report.overall).toBe('failed');
    expect(report.checks[0]?.status).toBe('failed');
    expect(report.checks[0]?.exitCode).toBe(1);
  });

  it('times out a hanging check and marks it as timeout', async () => {
    const repo = await tempRepo();
    await writeFile(
      join(repo, 'audit.config.json'),
      JSON.stringify({
        version: 1,
        checks: [
          {
            id: 'hang',
            argv: [process.execPath, '-e', 'setTimeout(() => {}, 2000)'],
            timeoutMs: 100,
          },
        ],
      }),
    );

    const report = await runAudit({
      repoPath: repo,
      configPath: join(repo, 'audit.config.json'),
      outDir: join(repo, '.code-audit'),
    });

    expect(report.overall).toBe('failed');
    expect(report.checks[0]?.status).toBe('timeout');
  });

  it('runs only the selected profile and records its summary', async () => {
    const repo = await tempRepo();
    await writeFile(
      join(repo, 'audit.config.json'),
      JSON.stringify({
        version: 1,
        profiles: {
          fast: ['typecheck'],
          release: ['typecheck', 'acceptance'],
        },
        checks: [
          {
            id: 'typecheck',
            kind: 'build',
            argv: [process.execPath, '-e', 'console.log("typecheck")'],
            requirementIds: ['REQ-001'],
          },
          {
            id: 'acceptance',
            kind: 'acceptance',
            argv: [process.execPath, '-e', 'console.log("acceptance")'],
            acceptanceIds: ['AC-001'],
          },
        ],
      }),
    );

    const report = await runAudit({
      repoPath: repo,
      configPath: join(repo, 'audit.config.json'),
      outDir: join(repo, '.code-audit'),
      profile: 'fast',
    });

    expect(report.profile).toBe('fast');
    expect(report.checks.map((check) => check.id)).toEqual(['typecheck']);
    expect(report.summary).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0,
      requiredFailures: 0,
      optionalFailures: 0,
      byKind: { build: 1 },
    });
    expect(report.checks[0]?.kind).toBe('build');
    expect(report.checks[0]?.requirementIds).toEqual(['REQ-001']);
    expect(report.evidence).toHaveLength(2);
    expect(report.evidence[0]?.checkId).toBe('typecheck');
    expect(report.evidence[0]?.stream).toBe('stdout');
  });

  it('hashes the exact evidence files it writes', async () => {
    const repo = await tempRepo();
    await writeFile(
      join(repo, 'audit.config.json'),
      JSON.stringify({
        version: 1,
        checks: [{ id: 'ok', argv: [process.execPath, '-e', 'console.log("hash me")'] }],
      }),
    );

    const report = await runAudit({
      repoPath: repo,
      configPath: join(repo, 'audit.config.json'),
      outDir: join(repo, '.code-audit'),
    });

    const stdout = await readFile(join(repo, '.code-audit', 'checks', 'ok.stdout.log'), 'utf8');
    const expected = createHash('sha256').update(stdout, 'utf8').digest('hex');
    expect(report.evidence.find((item) => item.stream === 'stdout')?.sha256).toBe(expected);
  });

  it('rejects an unknown profile before running checks', async () => {
    const repo = await tempRepo();
    await writeFile(
      join(repo, 'audit.config.json'),
      JSON.stringify({
        version: 1,
        profiles: { fast: ['ok'] },
        checks: [{ id: 'ok', argv: [process.execPath, '-e', 'process.exit(0)'] }],
      }),
    );

    await expect(
      runAudit({
        repoPath: repo,
        configPath: join(repo, 'audit.config.json'),
        outDir: join(repo, '.code-audit'),
        profile: 'release',
      }),
    ).rejects.toThrow(ConfigError);
  });
});
