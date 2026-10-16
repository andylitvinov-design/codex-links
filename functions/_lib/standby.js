// Fail closed by default: no KV access or command dispatch while the legacy app sleeps.
// This is a feature switch, not an authentication mechanism for resumed operation.
export function isStandbyEnabled(env) {
  return !["off", "false", "0"].includes(
    String(env?.CODEX_LINKS_STANDBY ?? "on").trim().toLowerCase()
  );
}

export function standbyResponse() {
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
