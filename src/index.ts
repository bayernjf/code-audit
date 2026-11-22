export { ConfigError, loadConfig, validateConfig } from './config.js';
export { readGitInfo } from './git.js';
export { runAudit, type RunAuditOptions } from './runner.js';
export { writeReports } from './report.js';
export { buildSarif, type SarifLog } from './sarif.js';
export { CODE_AUDIT_VERSION } from './version.js';
export type {
  AuditConfig,
  AuditReport,
  CheckResult,
  CheckSpec,
  CheckStatus,
  GitInfo,
} from './types.js';
