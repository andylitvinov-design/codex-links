// Request-local memoization only: never share successful values across users,
// requests, namespaces, or deployments. Writes invalidate the whole request memo.
export function withRequestKvMemo(env, binding = "LINKS_STORE") {
  const store = env?.[binding];
  if (!store || typeof store.get !== "function") return env;
  const pending = new Map();
  const wrapped = new Proxy(store, {
    get(target, property) {
      if (property === "get") return async (key, type) => {
        // Streams, buffers, bulk reads and custom options retain native semantics.
        if (typeof key !== "string" || ![undefined, "text", "json"].includes(type)) {
          return target.get(key, type);
        }
        const id = JSON.stringify([key, type || "text"]);
        if (!pending.has(id)) {
          const read = Promise.resolve().then(() => target.get(key, type));
          pending.set(id, read);
          // Failed reads are never interpreted as empty data or retained for retry.
          read.catch(() => { if (pending.get(id) === read) pending.delete(id); });
        }
        const value = await pending.get(id);
        return type === "json" && value !== null ? structuredClone(value) : value;
      };
      if (property === "put" || property === "delete") return async (...args) => {
        pending.clear();
        try { return await target[property](...args); }
        finally { pending.clear(); }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { ...env, [binding]: wrapped };
}

export function isKvReadLimitError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return /\bkv\b/.test(message) && message.includes("429")
    && /limit|rate|too many/.test(message);
}

function unavailable(until, now) {
  return Response.json({
    error: "rate_limited",
    message: "Storage is temporarily unavailable. Please retry later.",
    rateLimited: true
  }, { status: 429, headers: {
    "cache-control": "no-store, no-cache, must-revalidate",
    "retry-after": String(Math.max(1, Math.ceil((until - now) / 1000))),
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Retry-After"
  } });
}

// A short, automatically expiring GET-only circuit breaker. Cache API holds only
// a timestamp, never command/config/client data. It does not use Workers KV.
export function createKvReadGuard({
  run,
  binding = "LINKS_STORE",
  scope = "links-v1",
  now = () => Date.now(),
  cache = () => globalThis.caches?.default,
  cooldownMs = 300_000
}) {
  if (typeof run !== "function") throw new TypeError("run must be a function");
  if (!Number.isFinite(cooldownMs) || cooldownMs < 1000 || cooldownMs > 300_000) {
    throw new RangeError("cooldownMs must be between 1000 and 300000");
  }
  const gates = new Map();
  const remember = (origin, until) => {
    for (const [key, expiry] of gates) if (expiry <= now()) gates.delete(key);
    if (!gates.has(origin) && gates.size >= 32) gates.delete(gates.keys().next().value);
    gates.set(origin, until);
  };
  return async function guarded(context) {
    const { request, env } = context;
    // Do not interrupt callbacks, writes, authorization or preflight processing.
    if (request.method !== "GET" || !env?.[binding]) return run(context);
    const origin = new URL(request.url).origin;
    const key = new Request(new URL(`/__kv_read_cooldown__/${scope}`, origin));
    let edge;
    try { edge = cache(); } catch { /* Cache API is optional. */ }
    let until = gates.get(origin) || 0;
    if (until <= now() && edge) {
      try {
        const hit = await edge.match(key);
        const marker = hit ? await hit.json() : null;
        if (marker?.version === 1 && Number.isFinite(marker.until)
            && marker.until > now() && marker.until <= now() + cooldownMs) {
          until = marker.until;
          remember(origin, until);
        }
      } catch { /* Cache failure must not take healthy storage offline. */ }
    }
    if (until > now()) return unavailable(until, now());

    const trip = async () => {
      until = now() + cooldownMs;
      remember(origin, until);
      if (edge) {
        const save = Promise.resolve().then(() => edge.put(key, Response.json({
          version: 1, until
        }, { headers: { "cache-control": `max-age=${Math.ceil(cooldownMs / 1000)}` } })))
          .catch(() => {});
        if (typeof context.waitUntil === "function") context.waitUntil(save);
        else await save;
      }
      return unavailable(until, now());
    };
    let response;
    try { response = await run(context); }
    catch (error) {
      if (isKvReadLimitError(error)) return trip();
      throw error;
    }
    if (response.status === 429 || response.status === 500) {
      let data;
      try { data = await response.clone().json(); } catch { /* Not a KV error. */ }
      if ((data?.rateLimited === true && data?.error === "rate_limited")
          || isKvReadLimitError(data?.message)) return trip();
    }
    return response;
  };
}
