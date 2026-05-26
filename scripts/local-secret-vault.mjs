#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import process from "node:process";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8789;
const DEFAULT_TIMEOUT_MS = 15000;

const SECRET_REGISTRY = Object.freeze({
  hermes_telegram_bot_token: Object.freeze({
    id: "hermes_telegram_bot_token",
    label: "Hermes / Telegram Bot Token",
    project: "Hermes",
    service: "hermes-cloud",
    account: "TELEGRAM_BOT_TOKEN",
    apply: "store-only"
  }),
  hermes_telegram_allowed_user_ids: Object.freeze({
    id: "hermes_telegram_allowed_user_ids",
    label: "Hermes / Telegram Allowed User IDs",
    project: "Hermes",
    service: "hermes-cloud",
    account: "TELEGRAM_ALLOWED_USER_IDS",
    apply: "store-only"
  }),
  telegram_bot_token: Object.freeze({
    id: "telegram_bot_token",
    label: "Telegram Bot Token",
    project: "OpenClaw",
    service: "openclaw-telegram-gateway",
    account: "TELEGRAM_BOT_TOKEN",
    apply: "openclaw-telegram"
  }),
  codex_links_write_token: Object.freeze({
    id: "codex_links_write_token",
    label: "Codex Links Write Token",
    project: "Codex Links",
    service: "codex-links",
    account: "LINKS_WRITE_TOKEN",
    apply: "launchd-env"
  }),
  monobank_token: Object.freeze({
    id: "monobank_token",
    label: "Monobank Token",
    project: "Finance",
    service: "ezohata-finance",
    account: "MONOBANK_TOKEN",
    apply: "store-only"
  }),
  youtube_api_key: Object.freeze({
    id: "youtube_api_key",
    label: "YouTube Data API",
    project: "Reiki Yggdrasil",
    service: "youtube-data-api",
    account: "YOUTUBE_API_KEY",
    apply: "store-only",
    statusKey: "youtube_api_key_status",
    purpose: "Fetch public YouTube channel video inventory for @shamanic_academy and store normalized metadata in ai-projects-brain for Reiki Yggdrasil.",
    optionalVars: Object.freeze([
      Object.freeze({
        name: "YOUTUBE_CHANNEL_HANDLE",
        statusKey: "youtube_channel_handle",
        defaultValue: "@shamanic_academy"
      })
    ]),
    note: "Do not expose this key in frontend. Use server-side scripts/actions only.",
    help: "Use this key only for YouTube Data API v3."
  }),
  custom_secret: Object.freeze({
    id: "custom_secret",
    label: "Custom Secret",
    project: "Custom",
    service: "",
    account: "",
    apply: "store-only",
    custom: true
  })
});

function redact(value = "") {
  return String(value)
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TELEGRAM_BOT_TOKEN]")
    .replace(/(TOKEN=)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(token\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(-w\s+)[^\s]+/g, "$1[REDACTED]");
}

function htmlEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(data, status = 200) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(data, null, 2)
  };
}

function publicSecretMetadata(entry) {
  const { id, label, project, service, account, apply, custom, purpose, optionalVars, note, help, statusKey } = entry;
  return {
    id,
    label,
    project,
    service,
    account,
    apply,
    custom: Boolean(custom),
    purpose,
    optionalVars,
    note,
    help,
    statusKey
  };
}

async function getSecretStatus(entry, options = {}) {
  if (entry.custom) return null;
  const result = await readFromKeychain(entry, options);
  const status = {
    id: entry.id,
    account: entry.account,
    status: result.ok ? "configured" : "missing"
  };
  if (entry.statusKey) {
    status[entry.statusKey] = status.status;
  }
  for (const optional of entry.optionalVars || []) {
    const value = String(process.env[optional.name] || "").trim();
    status[optional.statusKey || optional.name] = value ? "configured" : "default";
    status[`${optional.name}_default`] = optional.defaultValue;
  }
  return status;
}

function htmlPage(options = {}) {
  const selectedSecretType = SECRET_REGISTRY[options.selectedSecretType] ? options.selectedSecretType : "hermes_telegram_bot_token";
  const optionTags = Object.values(SECRET_REGISTRY)
    .map((entry) => `<option value="${htmlEscape(entry.id)}"${entry.id === selectedSecretType ? " selected" : ""}>${htmlEscape(entry.label)}</option>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Local Secret Vault</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 20px; line-height: 1.45; }
    label { display: block; margin-top: 18px; font-weight: 650; }
    input, select, button { font: inherit; width: 100%; padding: 12px; box-sizing: border-box; margin-top: 6px; }
    button { margin-top: 20px; cursor: pointer; }
    pre { background: #111; color: #f7f7f7; padding: 14px; overflow: auto; border-radius: 8px; white-space: pre-wrap; }
    .note { color: #555; }
    .details { margin-top: 18px; padding: 14px; border: 1px solid #ddd; border-radius: 8px; background: #fafafa; }
    .details p { margin: 8px 0; }
  </style>
</head>
<body>
  <h1>Local Secret Vault</h1>
  <p class="note">Local-only page. Secrets are saved to macOS Keychain. Values are not sent to GitHub, ChatGPT, Cloudflare, or Vercel.</p>
  <form id="form">
    <label>Secret type</label>
    <select id="secretType">${optionTags}</select>
    <section id="secretDetails" class="details" aria-live="polite"></section>
    <div id="customFields" hidden>
      <label>Custom Keychain service</label>
      <input id="customService" autocomplete="off" />
      <label>Custom Keychain account</label>
      <input id="customAccount" autocomplete="off" />
    </div>
    <label>Secret value</label>
    <input id="secret" type="password" autocomplete="off" autofocus />
    <button type="submit">Save to Keychain + Apply</button>
  </form>
  <h2>Status</h2>
  <pre id="status">waiting</pre>
  <script>
    const type = document.getElementById('secretType');
    const custom = document.getElementById('customFields');
    const details = document.getElementById('secretDetails');
    let catalog = [];
    let statuses = {};
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }
    function renderDetails() {
      custom.hidden = type.value !== 'custom_secret';
      const entry = catalog.find((item) => item.id === type.value);
      if (!entry) {
        details.textContent = 'metadata loading...';
        return;
      }
      const status = statuses[entry.id]?.status || 'needs verification';
      const optionalRows = (entry.optionalVars || []).map((item) => {
        const valueStatus = statuses[entry.id]?.[item.statusKey || item.name] || 'default';
        return '<p><strong>' + escapeHtml(item.name) + ':</strong> ' + escapeHtml(valueStatus) + ' (default ' + escapeHtml(item.defaultValue) + ')</p>';
      }).join('');
      details.innerHTML = [
        '<p><strong>Provider:</strong> ' + escapeHtml(entry.label) + '</p>',
        '<p><strong>Status:</strong> ' + escapeHtml(status) + '</p>',
        '<p><strong>Secret name:</strong> ' + escapeHtml(entry.account || 'custom') + '</p>',
        optionalRows,
        entry.purpose ? '<p><strong>Purpose:</strong> ' + escapeHtml(entry.purpose) + '</p>' : '',
        entry.note ? '<p><strong>Note:</strong> ' + escapeHtml(entry.note) + '</p>' : '',
        entry.help ? '<p><strong>Help:</strong> ' + escapeHtml(entry.help) + '</p>' : ''
      ].join('');
    }
    async function loadCatalog() {
      const res = await fetch('/api/secrets/catalog');
      const json = await res.json();
      catalog = json.secrets || [];
      statuses = json.statuses || {};
      renderDetails();
    }
    type.addEventListener('change', renderDetails);
    loadCatalog().catch(() => {
      details.textContent = 'metadata unavailable';
      custom.hidden = type.value !== 'custom_secret';
    });
    document.getElementById('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.getElementById('status');
      status.textContent = 'saving...';
      const res = await fetch('/api/secrets/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          secretType: type.value,
          secret: document.getElementById('secret').value,
          customService: document.getElementById('customService').value,
          customAccount: document.getElementById('customAccount').value
        })
      });
      const json = await res.json();
      document.getElementById('secret').value = '';
      status.textContent = JSON.stringify(json, null, 2);
      await loadCatalog();
    });
  </script>
</body>
</html>`;
}

function runCommand(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: 127, timedOut, stdout, stderr: String(error?.message || error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, timedOut, stdout, stderr });
    });
  });
}

function resolveSecretConfig(payload = {}) {
  const secretType = String(payload.secretType || "").trim();
  const entry = SECRET_REGISTRY[secretType];
  if (!entry) return { ok: false, error: "Unknown secret type." };
  if (entry.custom) {
    const service = String(payload.customService || "").trim();
    const account = String(payload.customAccount || "").trim();
    if (!service || !account) return { ok: false, error: "Custom service and account are required." };
    return { ok: true, value: { ...entry, service, account } };
  }
  return { ok: true, value: entry };
}

async function saveToKeychain(config, secret, options = {}) {
  const run = options.runCommand || runCommand;
  const result = await run("security", [
    "add-generic-password",
    "-U",
    "-s", config.service,
    "-a", config.account,
    "-w", secret
  ]);
  return {
    ok: result.ok,
    error: result.ok ? "" : redact(result.stderr || result.stdout)
  };
}

async function readFromKeychain(config, options = {}) {
  const run = options.runCommand || runCommand;
  const result = await run("security", [
    "find-generic-password",
    "-s", config.service,
    "-a", config.account,
    "-w"
  ]);
  return {
    ok: result.ok,
    value: result.ok ? String(result.stdout || "").trimEnd() : "",
    error: result.ok ? "" : redact(result.stderr || result.stdout)
  };
}

function parseJsonFromOutput(output = "") {
  const text = String(output || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function summarizeTelegramApply({ seeded, repair, status }) {
  const repairData = parseJsonFromOutput(repair.stdout || repair.stderr || "");
  const statusData = parseJsonFromOutput(status.stdout || status.stderr || "");
  const finalStatus = statusData?.after || statusData?.status || statusData || {};
  return {
    applied: Boolean(seeded.ok && repair.ok),
    launchdSeeded: Boolean(seeded.ok),
    repairOk: Boolean(repair.ok),
    statusOk: Boolean(status.ok),
    keychainUsed: Boolean(repairData?.keychain_used || repairData?.keychainUsed),
    plistHasToken: Boolean(finalStatus?.plistHasToken),
    running: Boolean(finalStatus?.running),
    pid: Number(finalStatus?.pid || 0),
    tokenPresent: Boolean(finalStatus?.tokenPresent),
    status: finalStatus?.running && Number(finalStatus?.pid || 0) > 0 ? "running" : "needs_action",
    statusExcerpt: statusData ? "" : redact((status.stdout || status.stderr || "").slice(0, 600))
  };
}

async function applySecret(config, secret, options = {}) {
  const run = options.runCommand || runCommand;
  if (config.apply === "openclaw-telegram") {
    const seeded = await run("launchctl", ["setenv", config.account, secret]);
    const repair = await run("npm", ["run", "repair:openclaw:telegram-gateway"], { timeoutMs: 30000 });
    const status = await run("npm", ["run", "status:openclaw:telegram-gateway"], { timeoutMs: 15000 });
    const summary = summarizeTelegramApply({ seeded, repair, status });
    return {
      keychainService: config.service,
      keychainAccount: config.account,
      ...summary
    };
  }
  if (config.apply === "launchd-env") {
    const seeded = await run("launchctl", ["setenv", config.account, secret]);
    return {
      applied: seeded.ok,
      keychainService: config.service,
      keychainAccount: config.account,
      launchdSeeded: seeded.ok,
      statusExcerpt: seeded.ok ? "launchd env seeded" : redact(seeded.stderr || seeded.stdout)
    };
  }
  return {
    applied: true,
    keychainService: config.service,
    keychainAccount: config.account,
    mode: "store-only"
  };
}

async function handleSave(payload = {}, options = {}) {
  const secret = String(payload.secret || "");
  if (!secret.trim()) return safeJson({ ok: false, error: "Secret value is required." }, 400);
  const resolved = resolveSecretConfig(payload);
  if (!resolved.ok) return safeJson({ ok: false, error: resolved.error }, 400);
  const config = resolved.value;
  const saved = await saveToKeychain(config, secret, options);
  if (!saved.ok) return safeJson({ ok: false, saved: false, error: saved.error }, 500);
  const applied = await applySecret(config, secret, options);
  return safeJson({
    ok: true,
    saved: true,
    secretType: config.id,
    keychainService: config.service,
    keychainAccount: config.account,
    ...applied
  });
}

function resolveProjectSecret(project, account) {
  const normalizedProject = String(project || "").trim().toLowerCase();
  const normalizedAccount = String(account || "").trim();
  return Object.values(SECRET_REGISTRY).find((entry) => {
    return String(entry.project || "").toLowerCase() === normalizedProject && entry.account === normalizedAccount && !entry.custom;
  });
}

async function handleRead(payload = {}, options = {}) {
  const project = String(payload.project || "").trim();
  const names = Array.isArray(payload.names) ? payload.names.map((name) => String(name || "").trim()).filter(Boolean) : [];
  if (!project) return safeJson({ ok: false, error: "Project is required." }, 400);
  if (!names.length) return safeJson({ ok: false, error: "At least one secret name is required." }, 400);

  const secrets = {};
  for (const name of names) {
    const config = resolveProjectSecret(project, name);
    if (!config) {
      secrets[name] = { present: false, error: "Secret is not registered for project." };
      continue;
    }
    const result = await readFromKeychain(config, options);
    secrets[name] = result.ok
      ? { present: true, value: result.value }
      : { present: false, error: result.error || "Secret is not present." };
  }

  return safeJson({ ok: true, project, secrets });
}

async function readRequestJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function send(response, result) {
  response.writeHead(result.status || 200, result.headers || {});
  response.end(result.body || "");
}

function createVaultServer(options = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/secrets")) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(htmlPage({ selectedSecretType: options.selectedSecretType }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/secrets/catalog") {
        const secrets = Object.values(SECRET_REGISTRY);
        const statuses = {};
        for (const entry of secrets) {
          const status = await getSecretStatus(entry, options);
          if (status) statuses[entry.id] = status;
        }
        send(response, safeJson({ ok: true, secrets: secrets.map(publicSecretMetadata), statuses }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/secrets/status") {
        const youtube = await getSecretStatus(SECRET_REGISTRY.youtube_api_key, options);
        send(response, safeJson({ ok: true, youtube }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/secrets/save") {
        send(response, await handleSave(await readRequestJson(request), options));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/secrets/read") {
        send(response, await handleRead(await readRequestJson(request), options));
        return;
      }
      send(response, safeJson({ ok: false, error: "Not found." }, 404));
    } catch (error) {
      send(response, safeJson({ ok: false, error: redact(error?.message || String(error)) }, 500));
    }
  });
}

async function openBrowser(url) {
  if (process.env.CI || process.env.SECRET_VAULT_NO_OPEN === "1") return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await runCommand(command, args, { timeoutMs: 3000 });
}

async function startServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  if (host !== DEFAULT_HOST) throw new Error("Secret Vault must bind only to 127.0.0.1.");
  const server = createVaultServer({ selectedSecretType: options.selectedSecretType });
  server.listen(options.port || DEFAULT_PORT, host);
  await once(server, "listening");
  const address = server.address();
  const url = `http://${host}:${address.port}/secrets`;
  console.log(JSON.stringify({ ok: true, url, bindHost: host, supportedSecrets: Object.keys(SECRET_REGISTRY) }, null, 2));
  await openBrowser(url);
  return { server, url };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--secret") {
      result.selectedSecretType = argv[index + 1] || "";
      index += 1;
    } else if (value === "--status") {
      result.status = true;
    }
  }
  return result;
}

function formatYoutubeStatus(data = {}) {
  const youtube = data.youtube || {};
  const keyStatus = youtube.youtube_api_key_status === "configured" ? "configured" : "missing";
  const handleStatus = youtube.youtube_channel_handle === "configured" ? "configured" : "default";
  return [
    `YouTube API key: ${keyStatus}`,
    `Channel handle: ${handleStatus}`
  ].join("\n");
}

async function printYoutubeStatus(options = {}) {
  const port = Number(options.port || process.env.SECRET_VAULT_PORT || 8790) || 8790;
  const url = `http://127.0.0.1:${port}/api/secrets/status`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Secret Vault status returned HTTP ${response.status}.`);
  const data = await response.json();
  console.log(formatYoutubeStatus(data));
}

export {
  SECRET_REGISTRY,
  applySecret,
  formatYoutubeStatus,
  htmlPage,
  parseCliArgs,
  parseJsonFromOutput,
  printYoutubeStatus,
  redact,
  resolveSecretConfig,
  saveToKeychain,
  summarizeTelegramApply,
  handleSave,
  createVaultServer,
  handleRead,
  readFromKeychain,
  startServer
};

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const args = parseCliArgs();
  if (args.status) {
    await printYoutubeStatus();
  } else {
    await startServer({
      port: Number(process.env.SECRET_VAULT_PORT || DEFAULT_PORT) || DEFAULT_PORT,
      selectedSecretType: args.selectedSecretType
    });
  }
}
