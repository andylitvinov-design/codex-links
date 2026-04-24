function normalizeId(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

export function createRunId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function readJson(env, key) {
  return env.SAVE_STORE.get(key, "json");
}

export async function writeJson(env, key, value) {
  await env.SAVE_STORE.put(key, JSON.stringify(value));
  return value;
}

export async function readLatestId(env, key) {
  return normalizeId(await env.SAVE_STORE.get(key), 200);
}

export async function writeLatestId(env, key, value) {
  const normalized = normalizeId(value, 200);
  if (normalized) {
    await env.SAVE_STORE.put(key, normalized);
  }
  return normalized;
}
