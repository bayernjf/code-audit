import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { readGitInfo } from './git.js';
import { writeReports } from './report.js';
import type { AuditReport, CheckResult, CheckSpec } from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface RunAuditOptions {
  repoPath: string;
  configPath: string;
  outDir: string;
  maxOutputBytes?: number;
}

interface CollectedOutput {
  chunks: Buffer[];
  bytes: number;
  kept: number;
  truncated: boolean;
}

function appendOutput(collected: CollectedOutput, chunk: Buffer | string, maxBytes: number): void {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  collected.bytes += buffer.length;
  if (collected.kept < maxBytes) {
    const slice = buffer.subarray(0, maxBytes - collected.kept);
    collected.chunks.push(slice);
    collected.kept += slice.length;
  }
  if (collected.kept >= maxBytes && collected.bytes > collected.kept) {
    collected.truncated = true;
  }
}

function renderOutput(collected: CollectedOutput): string {
  const body = Buffer.concat(collected.chunks).toString('utf8');
  if (!collected.truncated) return body;
  return `${body}\n...[truncated ${collected.bytes - collected.kept} bytes]\n`;
}

function resolveInside(repoPath: string, pathValue: string): string {
  const resolved = resolve(repoPath, pathValue);
  const rel = relative(repoPath, resolved);
  if (rel.startsWith('..')) {
    throw new Error(`cwd must stay inside repo: ${pathValue}`);
  }
  return resolved;
}

async function runCheck(
  repoPath: string,
  outDir: string,
  check: CheckSpec,
  maxOutputBytes: number,
): Promise<CheckResult> {
  const cwd = resolveInside(repoPath, check.cwd ?? '.');
  const startedAt = process.hrtime.bigint();
  const stdout: CollectedOutput = { chunks: [], bytes: 0, kept: 0, truncated: false };
  const stderr: CollectedOutput = { chunks: [], bytes: 0, kept: 0, truncated: false };
  let timedOut = false;
  let errorMessage: string | undefined;
  let exitCode: number | null = null;
  let signal: string | null = null;

  const outcome = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (code: number | null, childSignal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      exitCode = code;
      signal = childSignal;
      resolve({ code, signal: childSignal });
    };

    let child: ChildProcess | undefined;
    try {
      child = spawn(check.argv[0] as string, check.argv.slice(1), {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      finish(null, null);
      return;
    }

    if (!child) {
      errorMessage = 'failed to spawn child process';
      finish(null, null);
      return;
    }

    child.stdout?.on('data', (chunk: Buffer | string) => appendOutput(stdout, chunk, maxOutputBytes));
    child.stderr?.on('data', (chunk: Buffer | string) => appendOutput(stderr, chunk, maxOutputBytes));

    child.on('error', (error) => {
      errorMessage = error.message;
      finish(null, null);
    });
    child.on('close', (code, childSignal) => finish(code, childSignal));

    const timeout = check.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    timer = setTimeout(() => {
      timedOut = true;
      child?.kill('SIGKILL');
    }, timeout);
  });

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const status = errorMessage
    ? 'error'
    : timedOut
      ? 'timeout'
      : outcome.code === 0
        ? 'passed'
        : 'failed';

  const stdoutPath = join('checks', `${check.id}.stdout.log`);
  const stderrPath = join('checks', `${check.id}.stderr.log`);
  await writeFile(join(outDir, stdoutPath), renderOutput(stdout), 'utf8');
  await writeFile(join(outDir, stderrPath), renderOutput(stderr), 'utf8');

  return {
    id: check.id,
    title: check.title ?? check.id,
    required: check.required ?? true,
    argv: check.argv,
    status,
    exitCode,
    signal,
    durationMs: Math.round(durationMs),
    stdoutPath,
    stderrPath,
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
    ...(errorMessage ? { error: errorMessage } : {}),
  };
}

export async function runAudit(options: RunAuditOptions): Promise<AuditReport> {
  const repoPath = resolve(options.repoPath);
  const configPath = resolve(options.configPath);
  const outDir = resolve(options.outDir);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const info = await stat(repoPath);
  if (!info.isDirectory()) throw new Error(`repo is not a directory: ${repoPath}`);

  const config = await loadConfig(configPath);
  await mkdir(join(outDir, 'checks'), { recursive: true });

  const git = await readGitInfo(repoPath);
  const checks: CheckResult[] = [];
  for (const check of config.checks) {
    checks.push(await runCheck(repoPath, outDir, check, maxOutputBytes));
  }

  const overall: AuditReport['overall'] = checks.every((check) => !check.required || check.status === 'passed')
    ? 'passed'
    : 'failed';

  const report: AuditReport = {
    version: 1,
    repoPath,
    configPath,
    outDir,
    generatedAt: new Date().toISOString(),
    ...(git ? { git } : {}),
    overall,
    checks,
  };

  await writeReports(report);
  return report;
}
