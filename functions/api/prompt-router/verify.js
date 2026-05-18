import { handleOptions, json } from "../../_lib/http.js";
import { verifyPromptRouterPrompt } from "../../_lib/prompt-router.js";
import { getSafePromptMetadata } from "../../_lib/prompt-router-security.js";

export async function onRequest(context) {
  const { request } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "validation_error", message: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const result = verifyPromptRouterPrompt(payload);

    if (!result.ok) {
      return json(result, { status: 400 });
    }

    console.log("[prompt-router] verify", getSafePromptMetadata(payload));
    return json(result);
  } catch (error) {
    return json({
      ok: false,
      error: "verify_failed",
      message: String(error?.message || "Prompt verification failed.")
    }, { status: 500 });
  }
}
