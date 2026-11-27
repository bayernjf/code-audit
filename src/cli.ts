#!/usr/bin/env node
import { resolve } from 'node:path';
import { ConfigError } from './config.js';
import { runAudit } from './runner.js';
import { CODE_AUDIT_VERSION } from './version.js';

const HELP = `code-audit — run configured audit checks and write an evidence bundle.

Usage:
  code-audit [options]

Options:
  --repo <path>      repository to audit (default: current directory)
  --config <path>    audit config, relative to repo (default: audit.config.json)
  --profile <name>   run only the checks listed in the named config profile
  --out <path>       output directory, relative to repo (default: .code-audit)
  --help             show this help
  --version          show version

Exit codes:
  0  all required checks passed
  1  at least one required check failed, timed out, or failed to start
  2  invalid arguments or invalid config
`;

interface CliOptions {
  repo: string;
  config: string;
  profile?: string;
  out: string;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    repo: process.cwd(),
    config: 'audit.config.json',
    out: '.code-audit',
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      options.version = true;
      continue;
    }
    if (arg === '--repo' || arg === '--config' || arg === '--profile' || arg === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--repo') options.repo = value;
      if (arg === '--config') options.config = value;
      if (arg === '--profile') options.profile = value;
      if (arg === '--out') options.out = value;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.version) {
    process.stdout.write(`code-audit ${CODE_AUDIT_VERSION}\n`);
    return;
  }

  const repoPath = resolve(options.repo);
  const configPath = resolve(repoPath, options.config);
  const outDir = resolve(repoPath, options.out);
  const report = await runAudit({
    repoPath,
    configPath,
    outDir,
    ...(options.profile ? { profile: options.profile } : {}),
  });

  process.stdout.write(`repo: ${report.repoPath}\n`);
  if (report.profile) process.stdout.write(`profile: ${report.profile}\n`);
  if (report.git) {
    const commit = report.git.commit ? report.git.commit.slice(0, 12) : 'unknown';
    process.stdout.write(`git: ${report.git.branch ?? 'detached'} @ ${commit}${report.git.dirty ? ' (dirty)' : ''}\n`);
  }
  for (const check of report.checks) {
    process.stdout.write(
      `[${check.status}] ${check.id} (${check.durationMs}ms)${check.error ? `: ${check.error}` : ''}\n`,
    );
  }
  process.stdout.write(
    `summary: ${report.summary.passed}/${report.summary.total} passed, ` +
      `${report.summary.requiredFailures} required failure(s), ` +
      `${report.summary.optionalFailures} optional failure(s)\n`,
  );
  process.stdout.write(`overall: ${report.overall}\n`);
  process.stdout.write(`report: ${report.outDir}/report.json\n`);
  process.exitCode = report.overall === 'passed' ? 0 : 1;
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    process.stderr.write(`config error: ${error.message}\n`);
  } else {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 2;
});
