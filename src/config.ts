import { readFile } from 'node:fs/promises';
import type { AuditConfig, CheckSpec } from './types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const MAX_CHECKS = 50;
const MAX_TIMEOUT_MS = 600_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function validateCheck(value: unknown, index: number): CheckSpec {
  if (!isRecord(value)) throw new ConfigError(`checks[${index}] must be an object`);
  const id = nonEmptyString(value.id, `checks[${index}].id`);
  if (!ID_PATTERN.test(id)) {
    throw new ConfigError(`checks[${index}].id must match ${ID_PATTERN.source}`);
  }

  if (!Array.isArray(value.argv) || value.argv.length === 0) {
    throw new ConfigError(`checks[${index}].argv must be a non-empty array`);
  }
  const argv = value.argv.map((arg, argIndex) => nonEmptyString(arg, `checks[${index}].argv[${argIndex}]`));

  const check: CheckSpec = { id, argv };

  if (value.title !== undefined) {
    check.title = nonEmptyString(value.title, `checks[${index}].title`);
  }
  if (value.cwd !== undefined) {
    const cwd = nonEmptyString(value.cwd, `checks[${index}].cwd`);
    if (cwd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwd)) {
      throw new ConfigError(`checks[${index}].cwd must be repo-relative`);
    }
    check.cwd = cwd;
  }
  if (value.required !== undefined) {
    if (typeof value.required !== 'boolean') {
      throw new ConfigError(`checks[${index}].required must be a boolean`);
    }
    check.required = value.required;
  }
  if (value.timeoutMs !== undefined) {
    if (
      typeof value.timeoutMs !== 'number' ||
      !Number.isInteger(value.timeoutMs) ||
      value.timeoutMs <= 0 ||
      value.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new ConfigError(`checks[${index}].timeoutMs must be an integer in 1..${MAX_TIMEOUT_MS}`);
    }
    check.timeoutMs = value.timeoutMs;
  }

  return check;
}

export function validateConfig(value: unknown): AuditConfig {
  if (!isRecord(value)) throw new ConfigError('config must be an object');
  if (value.version !== 1) throw new ConfigError('config.version must be 1');
  if (!Array.isArray(value.checks) || value.checks.length === 0) {
    throw new ConfigError('config.checks must be a non-empty array');
  }
  if (value.checks.length > MAX_CHECKS) {
    throw new ConfigError(`config.checks must contain at most ${MAX_CHECKS} checks`);
  }

  const checks = value.checks.map((check, index) => validateCheck(check, index));
  const ids = new Set<string>();
  for (const check of checks) {
    if (ids.has(check.id)) throw new ConfigError(`duplicate check id: ${check.id}`);
    ids.add(check.id);
  }

  return { version: 1, checks };
}

export async function loadConfig(configPath: string): Promise<AuditConfig> {
  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new ConfigError(`cannot read config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  return validateConfig(parsed);
}
