// Stop diagnostics/remediation storage reads and command creation during standby.
// Independent Pages project: this guard does not affect codex-links itself.
const isStandby = (env) =>
  !["off", "false", "0"].includes(String(env?.CODEX_SAVE_STANDBY ?? "on").trim().toLowerCase());

export async function onRequest(context) {
  if (!isStandby(context.env)) {
    return context.next();
  }

  return new Response(JSON.stringify({
    error: "Codex Save API is temporarily paused.",
    code: "service_standby"
  }), {
    status: 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "3600"
    }
  });
}
