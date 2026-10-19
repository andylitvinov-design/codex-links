import { createKvReadGuard, withRequestKvMemo } from "../_lib/kv-read-guard.js";
import { onRequest as delivery } from "./delivery.js";
import { onRequest as status } from "./status.js";

// Only public polling routes may be short-circuited before their handlers.
// Protected reads must always reach their own authorization checks.
const KV_POLL_PATHS = new Set(["/api/delivery", "/api/status"]);
const guarded = createKvReadGuard({
  async run(context) {
    if (context.request.method === "GET") {
      const path = new URL(context.request.url).pathname.replace(/\/$/, "");
      const handler = path === "/api/delivery" ? delivery : path === "/api/status" ? status : null;
      // Fresh private context: never mutate context.env or cache successful data
      // between requests. Other handlers retain normal Pages routing.
      if (handler) return handler({ ...context, env: withRequestKvMemo(context.env) });
    }
    return context.next();
  }
});

export function onRequest(context) {
  const path = new URL(context.request.url).pathname.replace(/\/$/, "");
  return KV_POLL_PATHS.has(path) ? guarded(context) : context.next();
}
