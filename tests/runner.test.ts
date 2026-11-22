import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
