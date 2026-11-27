export const CHECK_KINDS = ['check', 'build', 'test', 'security', 'acceptance'] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export interface CheckSpec {
  id: string;
  title?: string;
  kind?: CheckKind;
  argv: string[];
  cwd?: string;
  required?: boolean;
  timeoutMs?: number;
  requirementIds?: string[];
  acceptanceIds?: string[];
}

export interface AuditConfig {
  version: 1;
  profiles?: Record<string, string[]>;
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
  kind: CheckKind;
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
  requirementIds?: string[];
  acceptanceIds?: string[];
  error?: string;
}

export interface EvidenceFile {
  checkId: string;
  stream: 'stdout' | 'stderr';
  path: string;
  sha256: string;
  bytes: number;
  truncated: boolean;
}

export interface AuditSummary {
  total: number;
  passed: number;
  failed: number;
  requiredFailures: number;
  optionalFailures: number;
  byKind: Record<string, number>;
}

export interface AuditReport {
  version: 1;
  repoPath: string;
  configPath: string;
  outDir: string;
  generatedAt: string;
  profile?: string;
  git?: GitInfo;
  overall: 'passed' | 'failed';
  summary: AuditSummary;
  checks: CheckResult[];
  evidence: EvidenceFile[];
}
