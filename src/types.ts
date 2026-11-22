export interface CheckSpec {
  id: string;
  title?: string;
  argv: string[];
  cwd?: string;
  required?: boolean;
  timeoutMs?: number;
}

export interface AuditConfig {
  version: 1;
  checks: CheckSpec[];
}

export type CheckStatus = 'passed' | 'failed' | 'timeout' | 'error';

export interface GitInfo {
  commit?: string;
  branch?: string;
  dirty?: boolean;
}

export interface CheckResult {
  id: string;
  title: string;
  required: boolean;
  argv: string[];
  status: CheckStatus;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
  stdoutBytes: number;
  stderrBytes: number;
  error?: string;
}

export interface AuditReport {
  version: 1;
  repoPath: string;
  configPath: string;
  outDir: string;
  generatedAt: string;
  git?: GitInfo;
  overall: 'passed' | 'failed';
  checks: CheckResult[];
}
