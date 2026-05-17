#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { EOL } from 'node:os';

export const DEFAULT_KEYCHAIN_SERVICE = 'openclaw-telegram-gateway';
export const DEFAULT_KEYCHAIN_ACCOUNT = 'TELEGRAM_BOT_TOKEN';
export const DEFAULT_LAUNCHD_LABEL = 'com.ezohata.openclaw.telegram-gateway';
export const DEFAULT_TIMEOUT_MS = 8000;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function bool(value) {
  return value ? true : false;
}

export function redactSecret(text, secret) {
  const source = String(text ?? '');
  const token = normalizeText(secret);
  if (!token) return source;
  return source.split(token).join('[REDACTED]');
}

export function redactedResult(result, secret) {
  return {
    ...result,
    stdout: redactSecret(result?.stdout || '', secret),
    stderr: redactSecret(result?.stderr || '', secret)
  };
}

export function parseLaunchctlPrint(output = '') {
  const text = String(output || '');
  const pidMatch = text.match(/\bpid\s*=\s*(\d+)/i);
  const stateMatch = text.match(/\bstate\s*=\s*([^\n;]+)/i);
  const lastExitMatch = text.match(/\blast exit code\s*=\s*(-?\d+)/i) || text.match(/\blastExitCode\s*=\s*(-?\d+)/i);
  const pid = pidMatch ? Number(pidMatch[1]) : 0;
  return {
    installed: /\bstate\s*=|\bpid\s*=|\bprogram\s*=|\bpath\s*=/i.test(text),
    running: Number.isFinite(pid) && pid > 0,
    pid: Number.isFinite(pid) ? pid : 0,
    state: stateMatch ? normalizeText(stateMatch[1]).replace(/[;]+$/, '') : '',
    lastExitCode: lastExitMatch ? Number(lastExitMatch[1]) : null
  };
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {
    action: 'repair',
    json: false,
    service: env.OPENCLAW_TELEGRAM_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE,
    account: env.OPENCLAW_TELEGRAM_KEYCHAIN_ACCOUNT || DEFAULT_KEYCHAIN_ACCOUNT,
    label: env.OPENCLAW_TELEGRAM_LAUNCHD_LABEL || DEFAULT_LAUNCHD_LABEL,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === 'repair' || arg === 'status') {
      args.action = arg;
      continue;
    }
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--label') {
      args.label = normalizeText(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      const timeoutMs = Number(argv[index + 1]);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms must be positive');
      args.timeoutMs = Math.floor(timeoutMs);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function runCommand(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ ok: false, code: null, timedOut: true, stdout, stderr });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => finish({ ok: false, code: null, timedOut: false, stdout, stderr: stderr || error.message }));
    child.on('close', (code) => finish({ ok: code === 0, code, timedOut: false, stdout, stderr }));
  });
}

async function exec(runner, command, args, options = {}) {
  const fn = runner || runCommand;
  return fn(command, args, options);
}

export async function readKeychainToken(config, runner) {
  const result = await exec(runner, 'security', [
    'find-generic-password',
    '-s', config.service,
    '-a', config.account,
    '-w'
  ], { timeoutMs: config.timeoutMs });
  if (!result.ok) return null;
  return normalizeText(result.stdout);
}

export async function storeKeychainToken(config, token, runner) {
  if (!normalizeText(token)) return false;
  const result = await exec(runner, 'security', [
    'add-generic-password',
    '-U',
    '-s', config.service,
    '-a', config.account,
    '-w', token
  ], { timeoutMs: config.timeoutMs });
  return bool(result.ok);
}

export async function seedLaunchdToken(config, token, runner) {
  const result = await exec(runner, 'launchctl', [
    'setenv',
    'TELEGRAM_BOT_TOKEN',
    token
  ], { timeoutMs: config.timeoutMs });
  return bool(result.ok);
}

export async function resolveTelegramToken(config, env = process.env, runner) {
  const shellToken = normalizeText(env.TELEGRAM_BOT_TOKEN);
  if (shellToken) {
    await storeKeychainToken(config, shellToken, runner);
    return { token: shellToken, source: 'shell_and_keychain' };
  }
  const keychainToken = await readKeychainToken(config, runner);
  if (keychainToken) return { token: keychainToken, source: 'keychain' };
  return { token: '', source: 'missing' };
}

export async function readLaunchdStatus(config, runner, secret = '') {
  const target = `gui/${process.getuid?.() ?? 501}/${config.label}`;
  const result = await exec(runner, 'launchctl', ['print', target], { timeoutMs: config.timeoutMs });
  const parsed = result.ok ? parseLaunchctlPrint(result.stdout) : {
    installed: false,
    running: false,
    pid: 0,
    state: '',
    lastExitCode: null
  };
  return {
    ...parsed,
    label: config.label,
    launchctlOk: bool(result.ok),
    recentLogExcerpt: redactSecret((result.stderr || result.stdout || '').slice(0, 600), secret)
  };
}

export async function kickstartLaunchAgent(config, runner) {
  const target = `gui/${process.getuid?.() ?? 501}/${config.label}`;
  const result = await exec(runner, 'launchctl', ['kickstart', '-k', target], { timeoutMs: config.timeoutMs });
  return bool(result.ok);
}

export async function repairTelegramGateway(config, env = process.env, runner) {
  const resolved = await resolveTelegramToken(config, env, runner);
  if (!resolved.token) {
    return {
      ok: false,
      status: 'needs_action',
      failingLayer: 'launchd/local env lifecycle',
      tokenSource: 'missing',
      message: 'Telegram token is not present in shell or macOS Keychain. Store it once in Keychain, then repair can run without re-entry.',
      oneTimeSetup: `security add-generic-password -U -s ${config.service} -a ${config.account} -w '<TELEGRAM_BOT_TOKEN>'`,
      statusCheck: await readLaunchdStatus(config, runner)
    };
  }

  const launchdSeeded = await seedLaunchdToken(config, resolved.token, runner);
  const kickstarted = await kickstartLaunchAgent(config, runner);
  const statusCheck = await readLaunchdStatus(config, runner, resolved.token);
  const running = bool(statusCheck.running && statusCheck.pid > 0);

  return {
    ok: running,
    status: running ? 'ok' : 'needs_action',
    failingLayer: running ? '' : 'launchd/local env lifecycle',
    tokenSource: resolved.source,
    launchdSeeded,
    kickstarted,
    statusCheck,
    message: running
      ? 'OpenClaw Telegram gateway is running. Telegram link may be shown by the caller.'
      : 'Token was found and seeded, but LaunchAgent is still not running. Inspect redacted statusCheck.recentLogExcerpt.'
  };
}

function printHuman(result) {
  const lines = [
    `status=${result.status}`,
    result.failingLayer ? `failingLayer=${result.failingLayer}` : '',
    result.tokenSource ? `tokenSource=${result.tokenSource}` : '',
    result.launchdSeeded !== undefined ? `launchdSeeded=${result.launchdSeeded}` : '',
    result.kickstarted !== undefined ? `kickstarted=${result.kickstarted}` : '',
    result.statusCheck ? `installed=${result.statusCheck.installed}` : '',
    result.statusCheck ? `running=${result.statusCheck.running}` : '',
    result.statusCheck ? `pid=${result.statusCheck.pid}` : '',
    result.statusCheck?.state ? `state=${result.statusCheck.state}` : '',
    result.statusCheck?.lastExitCode !== null && result.statusCheck?.lastExitCode !== undefined ? `lastExitCode=${result.statusCheck.lastExitCode}` : '',
    result.statusCheck?.recentLogExcerpt ? `recentLogExcerpt=${result.statusCheck.recentLogExcerpt}` : '',
    result.oneTimeSetup ? `oneTimeSetup=${result.oneTimeSetup}` : '',
    result.message ? `message=${result.message}` : ''
  ].filter(Boolean);
  process.stdout.write(`${lines.join(EOL)}${EOL}`);
}

export async function main(argv = process.argv.slice(2), env = process.env, runner) {
  const config = parseArgs(argv, env);
  const result = config.action === 'status'
    ? { status: 'ok', statusCheck: await readLaunchdStatus(config, runner) }
    : await repairTelegramGateway(config, env, runner);
  if (config.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}${EOL}`);
  } else {
    printHuman(result);
  }
  return result.ok === false ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}${EOL}`);
    process.exitCode = 1;
  });
}
