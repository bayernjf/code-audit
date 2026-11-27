import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { ConfigError, loadConfig } from './config.js';
import { readGitInfo } from './git.js';
import { writeReports } from './report.js';
import type {
  AuditConfig,
  AuditReport,
  AuditSummary,
  CheckResult,
  CheckSpec,
  EvidenceFile,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface RunAuditOptions {
  repoPath: string;
  configPath: string;
  outDir: string;
  profile?: string;
  maxOutputBytes?: number;
}

interface CollectedOutput {
  chunks: Buffer[];
  bytes: number;
  kept: number;
  truncated: boolean;
}

interface CheckExecution {
  result: CheckResult;
  evidence: EvidenceFile[];
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

function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function resolveInside(repoPath: string, pathValue: string): string {
  const resolved = resolve(repoPath, pathValue);
  const rel = relative(repoPath, resolved);
  if (rel.startsWith('..')) {
    throw new Error(`cwd must stay inside repo: ${pathValue}`);
  }
  return resolved;
}

function selectChecks(config: AuditConfig, profile: string | undefined): CheckSpec[] {
  if (profile === undefined) return config.checks;

  const selectedProfile = config.profiles?.[profile];
  if (!selectedProfile) throw new ConfigError(`unknown profile: ${profile}`);

  return selectedProfile.map((id) => {
    const check = config.checks.find((candidate) => candidate.id === id);
    if (!check) throw new ConfigError(`profile "${profile}" references unknown check: ${id}`);
    return check;
  });
}

async function runCheck(
  repoPath: string,
  outDir: string,
  check: CheckSpec,
  maxOutputBytes: number,
): Promise<CheckExecution> {
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

  const stdoutText = renderOutput(stdout);
  const stderrText = renderOutput(stderr);
  const stdoutPath = join('checks', `${check.id}.stdout.log`);
  const stderrPath = join('checks', `${check.id}.stderr.log`);
  const stdoutSha256 = digest(stdoutText);
  const stderrSha256 = digest(stderrText);

  await writeFile(join(outDir, stdoutPath), stdoutText, 'utf8');
  await writeFile(join(outDir, stderrPath), stderrText, 'utf8');

  return {
    result: {
      id: check.id,
      title: check.title ?? check.id,
      kind: check.kind ?? 'check',
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
      ...(check.requirementIds ? { requirementIds: check.requirementIds } : {}),
      ...(check.acceptanceIds ? { acceptanceIds: check.acceptanceIds } : {}),
      ...(errorMessage ? { error: errorMessage } : {}),
    },
    evidence: [
      {
        checkId: check.id,
        stream: 'stdout',
        path: stdoutPath,
        sha256: stdoutSha256,
        bytes: stdout.bytes,
        truncated: stdout.truncated,
      },
      {
        checkId: check.id,
        stream: 'stderr',
        path: stderrPath,
        sha256: stderrSha256,
        bytes: stderr.bytes,
        truncated: stderr.truncated,
      },
    ],
  };
}

function summarize(checks: CheckResult[]): AuditSummary {
  const byKind: Record<string, number> = {};
  let passed = 0;
  let requiredFailures = 0;
  let optionalFailures = 0;

  for (const check of checks) {
    byKind[check.kind] = (byKind[check.kind] ?? 0) + 1;
    if (check.status === 'passed') {
      passed += 1;
    } else if (check.required) {
      requiredFailures += 1;
    } else {
      optionalFailures += 1;
    }
  }

  return {
    total: checks.length,
    passed,
    failed: checks.length - passed,
    requiredFailures,
    optionalFailures,
    byKind,
  };
}

export async function runAudit(options: RunAuditOptions): Promise<AuditReport> {
  const repoPath = resolve(options.repoPath);
  const configPath = resolve(options.configPath);
  const outDir = resolve(options.outDir);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const profile = options.profile?.trim();

  if (options.profile !== undefined && profile === '') {
    throw new ConfigError('profile must be a non-empty string');
  }

  const info = await stat(repoPath);
  if (!info.isDirectory()) throw new Error(`repo is not a directory: ${repoPath}`);

  const config = await loadConfig(configPath);
  const selectedChecks = selectChecks(config, profile);
  await mkdir(join(outDir, 'checks'), { recursive: true });

  const git = await readGitInfo(repoPath);
  const checks: CheckResult[] = [];
  const evidence: EvidenceFile[] = [];
  for (const check of selectedChecks) {
    const execution = await runCheck(repoPath, outDir, check, maxOutputBytes);
    checks.push(execution.result);
    evidence.push(...execution.evidence);
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
    ...(profile ? { profile } : {}),
    ...(git ? { git } : {}),
    overall,
    summary: summarize(checks),
    checks,
    evidence,
  };

  await writeReports(report);
  return report;
}
