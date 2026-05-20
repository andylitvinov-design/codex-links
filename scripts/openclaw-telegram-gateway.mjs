#!/usr/bin/env node
import process from "node:process";

const DEFAULT_HEARTBEAT_MS = 60_000;

function redact(value = "") {
  return String(value)
    .replace(/(TELEGRAM_BOT_TOKEN=)[^\s]+/g, "$1[REDACTED]");
}

function log(event, details = {}) {
  const safe = JSON.stringify({
    ts: new Date().toISOString(),
    service: "openclaw-telegram-gateway",
    event,
    ...details
  }, (_, value) => typeof value === "string" ? redact(value) : value);
  console.log(safe);
}

async function verifyTelegramToken(token) {
  if (!token) return { ok: false, status: "missing_token", description: "TELEGRAM_BOT_TOKEN is not present in process env." };
  if (process.env.OPENCLAW_TELEGRAM_SKIP_API_VERIFY === "1") {
    return { ok: true, status: "skipped", description: "Telegram API verification skipped by OPENCLAW_TELEGRAM_SKIP_API_VERIFY=1." };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: "GET",
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        status: "telegram_api_error",
        httpStatus: response.status,
        description: redact(data?.description || text.slice(0, 200) || "Telegram API returned an error.")
      };
    }
    return {
      ok: true,
      status: "telegram_api_ok",
      botUsername: data.result?.username || "unknown"
    };
  } catch (error) {
    return {
      ok: false,
      status: "telegram_api_unreachable",
      description: redact(error?.message || String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const verification = await verifyTelegramToken(token);
  if (!verification.ok && verification.status === "missing_token") {
    log("startup_failed", verification);
    process.exitCode = 2;
    return;
  }

  if (!verification.ok) {
    log("startup_degraded", verification);
  } else {
    log("startup_ok", verification);
  }

  const heartbeatMs = Number(process.env.OPENCLAW_TELEGRAM_HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS);
  const interval = setInterval(() => {
    log("heartbeat", { status: "running" });
  }, Number.isFinite(heartbeatMs) && heartbeatMs >= 10_000 ? heartbeatMs : DEFAULT_HEARTBEAT_MS);

  process.on("SIGTERM", () => {
    clearInterval(interval);
    log("shutdown", { signal: "SIGTERM" });
    process.exit(0);
  });
  process.on("SIGINT", () => {
    clearInterval(interval);
    log("shutdown", { signal: "SIGINT" });
    process.exit(0);
  });
}

export { redact, verifyTelegramToken };

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
