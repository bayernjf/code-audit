import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditReport } from './types.js';
import { buildSarif } from './sarif.js';

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function markdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push('# Code Audit Report');
  lines.push('');
  lines.push(`- Repo: \`${report.repoPath}\``);
  lines.push(`- Config: \`${report.configPath}\``);
  if (report.profile) lines.push(`- Profile: \`${report.profile}\``);
  lines.push(`- Generated: ${report.generatedAt}`);
  if (report.git) {
    const commit = report.git.commit ? report.git.commit.slice(0, 12) : 'unknown';
    const branch = report.git.branch ?? 'detached';
    lines.push(`- Git: \`${branch}\` @ \`${commit}\`${report.git.dirty ? ' (dirty)' : ''}`);
  }
  lines.push('');
  lines.push(`**Overall: ${report.overall === 'passed' ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push(
    `Summary: ${report.summary.passed}/${report.summary.total} passed, ` +
      `${report.summary.requiredFailures} required failure(s), ` +
      `${report.summary.optionalFailures} optional failure(s).`,
  );
  lines.push('');
  lines.push('| Check | Kind | Required | Status | Exit | Duration |');
  lines.push('|---|---|---:|---|---:|---:|');
  for (const check of report.checks) {
    lines.push(
      `| ${cell(check.id)} | ${check.kind} | ${check.required ? 'yes' : 'no'} | ${check.status} | ${check.exitCode ?? '—'} | ${check.durationMs}ms |`,
    );
  }
  lines.push('');
  for (const check of report.checks) {
    lines.push(`## ${check.id}`);
    lines.push('');
    lines.push(`- Title: ${check.title}`);
    lines.push(`- Kind: \`${check.kind}\``);
    lines.push(`- Command: \`${check.argv.join(' ')}\``);
    lines.push(`- Status: \`${check.status}\``);
    if (check.requirementIds?.length) {
      lines.push(`- Requirements: ${check.requirementIds.map((id) => `\`${id}\``).join(', ')}`);
    }
    if (check.acceptanceIds?.length) {
      lines.push(`- Acceptance: ${check.acceptanceIds.map((id) => `\`${id}\``).join(', ')}`);
    }
    lines.push(`- stdout: \`${check.stdoutPath}\` (${check.stdoutBytes} bytes)`);
    lines.push(`- stderr: \`${check.stderrPath}\` (${check.stderrBytes} bytes)`);
    if (check.error) lines.push(`- Error: ${check.error}`);
    lines.push('');
  }
  lines.push('## Evidence digests');
  lines.push('');
  lines.push('| Check | Stream | Bytes | Truncated | SHA-256 |');
  lines.push('|---|---|---:|---:|---|');
  for (const evidence of report.evidence) {
    lines.push(
      `| ${cell(evidence.checkId)} | ${evidence.stream} | ${evidence.bytes} | ${evidence.truncated ? 'yes' : 'no'} | \`${evidence.sha256}\` |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export async function writeReports(report: AuditReport): Promise<void> {
  await writeFile(join(report.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(join(report.outDir, 'report.md'), markdown(report), 'utf8');
  await writeFile(join(report.outDir, 'report.sarif'), `${JSON.stringify(buildSarif(report), null, 2)}\n`, 'utf8');
}
