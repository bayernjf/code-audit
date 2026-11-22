import { describe, expect, it } from 'vitest';
import { buildSarif } from '../src/sarif.js';
import type { AuditReport, CheckResult } from '../src/types.js';

function check(overrides: Partial<CheckResult> & Pick<CheckResult, 'id' | 'status'>): CheckResult {
  const { id, status, ...rest } = overrides;
  return {
    id,
    title: id,
    kind: 'check',
    required: true,
    argv: ['node', '-e', 'process.exit(1)'],
    status,
    exitCode: 1,
    signal: null,
    durationMs: 12,
    stdoutPath: `checks/${id}.stdout.log`,
    stderrPath: `checks/${id}.stderr.log`,
    stdoutBytes: 0,
    stderrBytes: 0,
    ...rest,
  };
}

function report(checks: CheckResult[]): AuditReport {
  return {
    version: 1,
    repoPath: '/tmp/example-repo',
    configPath: '/tmp/example-repo/audit.config.json',
    outDir: '/tmp/example-repo/.code-audit',
    generatedAt: '2026-11-22T08:00:00.000Z',
    overall: 'failed',
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === 'passed').length,
      failed: checks.filter((check) => check.status !== 'passed').length,
      requiredFailures: checks.filter((check) => check.required && check.status !== 'passed').length,
      optionalFailures: checks.filter((check) => !check.required && check.status !== 'passed').length,
      byKind: {},
    },
    checks,
    evidence: [],
  };
}

describe('buildSarif', () => {
  it('maps required failures to error and optional failures to warning', () => {
    const sarif = buildSarif(
      report([
        check({ id: 'typecheck', status: 'passed', exitCode: 0, kind: 'build' }),
        check({
          id: 'required-test',
          status: 'failed',
          title: 'Required tests',
          kind: 'test',
          requirementIds: ['REQ-001'],
          acceptanceIds: ['AC-001'],
        }),
        check({ id: 'optional-lint', status: 'timeout', required: false, durationMs: 1200 }),
      ]),
    );

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-schema-2.1.0.json');
    expect(sarif.runs[0]?.tool.driver.name).toBe('code-audit');
    expect(sarif.runs[0]?.tool.driver.version).toBe('0.3.0');
    expect(sarif.runs[0]?.tool.driver.rules).toHaveLength(3);
    expect(sarif.runs[0]?.results).toHaveLength(2);

    const required = sarif.runs[0]?.results[0];
    expect(required?.ruleId).toBe('required-test');
    expect(required?.level).toBe('error');
    expect(required?.message.text).toContain('exit code 1');
    expect(required?.properties.kind).toBe('test');
    expect(required?.properties.requirementIds).toEqual(['REQ-001']);
    expect(required?.properties.acceptanceIds).toEqual(['AC-001']);
    expect(required?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      '.code-audit/checks/required-test.stdout.log',
    );

    const optional = sarif.runs[0]?.results[1];
    expect(optional?.ruleId).toBe('optional-lint');
    expect(optional?.level).toBe('warning');
    expect(optional?.message.text).toContain('timed out');

    expect(sarif.runs[0]?.invocations[0]?.exitCode).toBe(1);
    expect(sarif.runs[0]?.invocations[0]?.properties.requiredFailures).toBe(1);
    expect(sarif.runs[0]?.invocations[0]?.properties.optionalFailures).toBe(1);
  });

  it('produces no results when every check passes', () => {
    const sarif = buildSarif(
      report([check({ id: 'typecheck', status: 'passed', exitCode: 0 })]),
    );
    expect(sarif.runs[0]?.results).toEqual([]);
  });
});
