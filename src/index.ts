export { ConfigError, loadConfig, validateConfig } from './config.js';
export { readGitInfo } from './git.js';
export { runAudit, type RunAuditOptions } from './runner.js';
export { writeReports } from './report.js';
export type {
  AuditConfig,
  AuditReport,
  CheckResult,
  CheckSpec,
  CheckStatus,
  GitInfo,
} from './types.js';
