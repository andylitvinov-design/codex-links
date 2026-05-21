#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import process from "node:process";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8789;
const DEFAULT_TIMEOUT_MS = 15000;

const SECRET_REGISTRY = Object.freeze({
  telegram_bot_token: Object.freeze({
    id: "telegram_bot_token",
    label: "Telegram Bot Token",
    service: "openclaw-telegram-gateway",
    account: "TELEGRAM_BOT_TOKEN",
    apply: "openclaw-telegram"
  }),
  codex_links_write_token: Object.freeze({
    id: "codex_links_write_token",
    label: "Codex Links Write Token",
    service: "codex-links",
    account: "LINKS_WRITE_TOKEN",
    apply: "launchd-env"
  }),
  monobank_token: Object.freeze({
    id: "monobank_token",
    label: "Monobank Token",
    service: "ezohata-finance",
    account: "MONOBANK_TOKEN",
    apply: "store-only"
  }),
  custom_secret: Object.freeze({
    id: "custom_secret",
    label: "Custom Secret",
    service: "",
    account: "",
    apply: "store-only",
    custom: true
  })
});

function redact(value = "") {
  return String(value)
    .replace(/(TOKEN=)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(token\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(-w\s+)[^\s]+/g, "$1[REDACTED]");
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

function htmlPage() {
  const options = Object.values(SECRET_REGISTRY)
    .map((entry) => `<option value="${entry.id}">${entry.label}</option>`)
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
  </style>
</head>
<body>
  <h1>Local Secret Vault</h1>
  <p class="note">Local-only page. Secrets are saved to macOS Keychain. Values are not sent to GitHub, ChatGPT, Cloudflare, or Vercel.</p>
  <form id="form">
    <label>Secret type</label>
    <select id="secretType">${options}</select>
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
    type.addEventListener('change', () => { custom.hidden = type.value !== 'custom_secret'; });
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

async function saveToKeychain(config, secret) {
  const result = await runCommand("security", [
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

async function applySecret(config, secret) {
  if (config.apply === "openclaw-telegram") {
    const seeded = await runCommand("launchctl", ["setenv", config.account, secret]);
    const repair = await runCommand("npm", ["run", "repair:openclaw:telegram-gateway"], { timeoutMs: 30000 });
    const status = await runCommand("npm", ["run", "status:openclaw:telegram-gateway"], { timeoutMs: 15000 });
    return {
      applied: seeded.ok && repair.ok,
      keychainService: config.service,
      keychainAccount: config.account,
      launchdSeeded: seeded.ok,
      repairOk: repair.ok,
      statusOk: status.ok,
      statusExcerpt: redact((status.stdout || status.stderr || "").slice(0, 1200))
    };
  }
  if (config.apply === "launchd-env") {
    const seeded = await runCommand("launchctl", ["setenv", config.account, secret]);
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

async function handleSave(payload = {}) {
  const secret = String(payload.secret || "");
  if (!secret.trim()) return safeJson({ ok: false, error: "Secret value is required." }, 400);
  const resolved = resolveSecretConfig(payload);
  if (!resolved.ok) return safeJson({ ok: false, error: resolved.error }, 400);
  const config = resolved.value;
  const saved = await saveToKeychain(config, secret);
  if (!saved.ok) return safeJson({ ok: false, saved: false, error: saved.error }, 500);
  const applied = await applySecret(config, secret);
  return safeJson({
    ok: true,
    saved: true,
    secretType: config.id,
    keychainService: config.service,
    keychainAccount: config.account,
    ...applied
  });
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

function createVaultServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/secrets")) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(htmlPage());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/secrets/catalog") {
        send(response, safeJson({ ok: true, secrets: Object.values(SECRET_REGISTRY).map(({ id, label, service, account, apply, custom }) => ({ id, label, service, account, apply, custom: Boolean(custom) })) }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/secrets/save") {
        send(response, await handleSave(await readRequestJson(request)));
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
  const server = createVaultServer();
  server.listen(options.port || DEFAULT_PORT, host);
  await once(server, "listening");
  const address = server.address();
  const url = `http://${host}:${address.port}/secrets`;
  console.log(JSON.stringify({ ok: true, url, bindHost: host, supportedSecrets: Object.keys(SECRET_REGISTRY) }, null, 2));
  await openBrowser(url);
  return { server, url };
}

export {
  SECRET_REGISTRY,
  redact,
  resolveSecretConfig,
  handleSave,
  createVaultServer,
  startServer
};

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  await startServer({ port: Number(process.env.SECRET_VAULT_PORT || DEFAULT_PORT) || DEFAULT_PORT });
}
