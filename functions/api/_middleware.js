// Emergency reversible standby guard for KV-backed Pages Functions.
// The API stays closed by default; static Pages assets are outside this directory.
const isStandby = (env) =>
  !["off", "false", "0"].includes(String(env?.CODEX_LINKS_STANDBY ?? "on").trim().toLowerCase());

export async function onRequest(context) {
  if (!isStandby(context.env)) {
    return context.next();
  }

  return new Response(JSON.stringify({
    error: "Codex Links API is temporarily paused.",
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
