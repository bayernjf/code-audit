import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditReport } from './types.js';

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function markdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push('# Code Audit Report');
  lines.push('');
  lines.push(`- Repo: \`${report.repoPath}\``);
  lines.push(`- Config: \`${report.configPath}\``);
  lines.push(`- Generated: ${report.generatedAt}`);
  if (report.git) {
    const commit = report.git.commit ? report.git.commit.slice(0, 12) : 'unknown';
    const branch = report.git.branch ?? 'detached';
    lines.push(`- Git: \`${branch}\` @ \`${commit}\`${report.git.dirty ? ' (dirty)' : ''}`);
  }
  lines.push('');
  lines.push(`**Overall: ${report.overall === 'passed' ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push('| Check | Required | Status | Exit | Duration |');
  lines.push('|---|---:|---|---:|---:|');
  for (const check of report.checks) {
    lines.push(
      `| ${cell(check.id)} | ${check.required ? 'yes' : 'no'} | ${check.status} | ${check.exitCode ?? '—'} | ${check.durationMs}ms |`,
    );
  }
  lines.push('');
  for (const check of report.checks) {
    lines.push(`## ${check.id}`);
    lines.push('');
    lines.push(`- Command: \`${check.argv.join(' ')}\``);
    lines.push(`- Status: \`${check.status}\``);
    lines.push(`- stdout: \`${check.stdoutPath}\` (${check.stdoutBytes} bytes)`);
    lines.push(`- stderr: \`${check.stderrPath}\` (${check.stderrBytes} bytes)`);
    if (check.error) lines.push(`- Error: ${check.error}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export async function writeReports(report: AuditReport): Promise<void> {
  await writeFile(join(report.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(join(report.outDir, 'report.md'), markdown(report), 'utf8');
}
