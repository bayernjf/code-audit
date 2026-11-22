import { relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AuditReport, CheckResult } from './types.js';
import { CODE_AUDIT_VERSION } from './version.js';

/**
 * SARIF 2.1.0 projection of an audit report.
 *
 * SARIF is a findings format, so only checks that did not pass become
 * `results`. A required failure is an `error`; an optional failure is a
 * `warning`. Passing checks still appear under `rules` so a consumer can see
 * what the run covered.
 */

export interface SarifLog {
  version: '2.1.0';
  $schema: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      informationUri: string;
      version: string;
      rules: SarifRule[];
    };
  };
  invocations: SarifInvocation[];
  results: SarifResult[];
  properties: Record<string, unknown>;
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  properties: Record<string, unknown>;
}

interface SarifInvocation {
  executionSuccessful: boolean;
  endTimeUtc: string;
  exitCode: number;
  workingDirectory: { uri: string };
  properties: Record<string, unknown>;
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: 'error' | 'warning';
  message: { text: string };
  locations: SarifLocation[];
  properties: Record<string, unknown>;
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: { startLine: 1; startColumn: 1 };
  };
}

function artifactUri(repoPath: string, outDir: string, relativePath: string): string {
  const absolute = isAbsolute(relativePath) ? relativePath : `${outDir}/${relativePath}`;
  const rel = relative(repoPath, absolute);
  if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.split('\\').join('/');
  return pathToFileURL(absolute).href;
}

function resultLevel(check: CheckResult): 'error' | 'warning' {
  return check.required ? 'error' : 'warning';
}

function resultMessage(check: CheckResult): string {
  if (check.status === 'timeout') {
    return `Check "${check.id}" timed out after ${check.durationMs}ms.`;
  }
  if (check.status === 'error') {
    return `Check "${check.id}" could not run${check.error ? `: ${check.error}` : '.'}`;
  }
  return `Check "${check.id}" failed with exit code ${check.exitCode ?? 'unknown'}.`;
}

export function buildSarif(report: AuditReport): SarifLog {
  const rules: SarifRule[] = report.checks.map((check) => ({
    id: check.id,
    name: check.title,
    shortDescription: { text: check.title },
    fullDescription: {
      text: `Run ${check.argv.join(' ')}${check.required ? ' (required)' : ' (optional)'}.`,
    },
    properties: {
      required: check.required,
      kind: check.kind,
      command: check.argv,
      ...(check.requirementIds ? { requirementIds: check.requirementIds } : {}),
      ...(check.acceptanceIds ? { acceptanceIds: check.acceptanceIds } : {}),
    },
  }));

  const results: SarifResult[] = [];
  report.checks.forEach((check, ruleIndex) => {
    if (check.status === 'passed') return;
    results.push({
      ruleId: check.id,
      ruleIndex,
      level: resultLevel(check),
      message: { text: resultMessage(check) },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: artifactUri(report.repoPath, report.outDir, check.stdoutPath) },
            region: { startLine: 1, startColumn: 1 },
          },
        },
      ],
      properties: {
        status: check.status,
        kind: check.kind,
        exitCode: check.exitCode,
        signal: check.signal,
        durationMs: check.durationMs,
        stdout: check.stdoutPath,
        stderr: check.stderrPath,
        ...(check.requirementIds ? { requirementIds: check.requirementIds } : {}),
        ...(check.acceptanceIds ? { acceptanceIds: check.acceptanceIds } : {}),
        ...(check.error ? { error: check.error } : {}),
      },
    });
  });

  return {
    version: '2.1.0',
    $schema:
      'https://docs.oasis-open.org/sarif/sarif/v2.1.0/cs01/schemas/sarif-schema-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'code-audit',
            informationUri: 'https://github.com/bayernjf/code-audit',
            version: CODE_AUDIT_VERSION,
            rules,
          },
        },
        invocations: [
          {
            executionSuccessful: true,
            endTimeUtc: report.generatedAt,
            exitCode: report.overall === 'passed' ? 0 : 1,
            workingDirectory: { uri: pathToFileURL(report.repoPath).href },
            properties: {
              overall: report.overall,
              ...(report.profile ? { profile: report.profile } : {}),
              requiredFailures: report.checks.filter(
                (check) => check.required && check.status !== 'passed',
              ).length,
              optionalFailures: report.checks.filter(
                (check) => !check.required && check.status !== 'passed',
              ).length,
            },
          },
        ],
        results,
        properties: {
          generatedAt: report.generatedAt,
          repoPath: report.repoPath,
          ...(report.git ? { git: report.git } : {}),
        },
      },
    ],
  };
}
