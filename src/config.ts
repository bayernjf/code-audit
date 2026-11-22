import { readFile } from 'node:fs/promises';
import { CHECK_KINDS, type AuditConfig, type CheckKind, type CheckSpec } from './types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const MAX_CHECKS = 50;
const MAX_IDS_PER_CHECK = 100;
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

function idArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError(`${field} must be a non-empty array`);
  }
  if (value.length > maxItems) {
    throw new ConfigError(`${field} must contain at most ${maxItems} items`);
  }
  const items = value.map((item, index) => nonEmptyString(item, `${field}[${index}]`));
  const seen = new Set<string>();
  for (const item of items) {
    if (!ID_PATTERN.test(item)) {
      throw new ConfigError(`${field} items must match ${ID_PATTERN.source}`);
    }
    if (seen.has(item)) throw new ConfigError(`duplicate id in ${field}: ${item}`);
    seen.add(item);
  }
  return items;
}

function isCheckKind(value: unknown): value is CheckKind {
  return typeof value === 'string' && (CHECK_KINDS as readonly string[]).includes(value);
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
  if (value.kind !== undefined) {
    if (!isCheckKind(value.kind)) {
      throw new ConfigError(`checks[${index}].kind must be one of: ${CHECK_KINDS.join(', ')}`);
    }
    check.kind = value.kind;
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
  if (value.requirementIds !== undefined) {
    check.requirementIds = idArray(
      value.requirementIds,
      `checks[${index}].requirementIds`,
      MAX_IDS_PER_CHECK,
    );
  }
  if (value.acceptanceIds !== undefined) {
    check.acceptanceIds = idArray(
      value.acceptanceIds,
      `checks[${index}].acceptanceIds`,
      MAX_IDS_PER_CHECK,
    );
  }

  return check;
}

function validateProfiles(value: unknown, checks: CheckSpec[]): Record<string, string[]> {
  if (!isRecord(value)) throw new ConfigError('config.profiles must be an object');
  const names = Object.keys(value);
  if (names.length === 0) throw new ConfigError('config.profiles must contain at least one profile');

  const checkIds = new Set(checks.map((check) => check.id));
  const profiles: Record<string, string[]> = {};

  for (const name of names) {
    if (!ID_PATTERN.test(name)) {
      throw new ConfigError(`profile name must match ${ID_PATTERN.source}: ${name}`);
    }
    const ids = idArray(value[name], `profiles.${name}`, MAX_CHECKS);
    for (const id of ids) {
      if (!checkIds.has(id)) {
        throw new ConfigError(`profile "${name}" references unknown check: ${id}`);
      }
    }
    const selected = ids.map((id) => checks.find((check) => check.id === id));
    if (!selected.some((check) => check !== undefined && check.required !== false)) {
      throw new ConfigError(`profile "${name}" must include at least one required check`);
    }
    profiles[name] = ids;
  }

  return profiles;
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

  const profiles = value.profiles === undefined ? undefined : validateProfiles(value.profiles, checks);

  return {
    version: 1,
    ...(profiles ? { profiles } : {}),
    checks,
  };
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
