import { json, handleOptions } from "../../_lib/http.js";
import { verifyOpenClawLive } from "../../_lib/openclaw-verify.js";

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function onRequest(context) {
  const options = handleOptions(context.request);
  if (options) return options;

  const url = new URL(context.request.url);
  const input = context.request.method === "GET"
    ? Object.fromEntries(url.searchParams.entries())
    : await readJson(context.request);

  if (!["GET", "POST"].includes(context.request.method)) {
    return json({ ok: false, result: "fail", error: `Unsupported method: ${context.request.method}` }, { status: 405 });
  }

  const result = await verifyOpenClawLive(input, { fetchImpl: fetch });
  return json(result, { status: result.status || (result.ok ? 200 : 200) });
}
