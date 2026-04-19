import { createCommandError } from "./command-debug.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CLOUD_MODEL = "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = 60_000;

function normalizeText(value, max = 4_000) {
  return String(value || "").trim().slice(0, max);
}

function buildCloudInstructions(command) {
  const projectLabel = normalizeText(command?.projectLabel || command?.threadLabel || "Links", 160);
  const projectCategory = normalizeText(command?.projectCategory || "other", 120);
  const targetRepo = normalizeText(command?.targetRepo, 240);
  const targetRepoUrl = normalizeText(command?.targetRepoUrl, 400);
  const workspacePath = normalizeText(command?.targetWorkspacePath, 500);
  const contextFiles = Array.isArray(command?.targetContextFiles)
    ? command.targetContextFiles.map((item) => normalizeText(item, 120)).filter(Boolean)
    : [];

  return [
    "You are Codex Links cloud execution.",
    "Be concise and task-focused.",
    "Treat the request as repository work context, not as a public chatbot conversation.",
    "If the user asks for code or repo changes, describe the concrete result and next action clearly.",
    `Project label: ${projectLabel}`,
    `Project category: ${projectCategory}`,
    targetRepo ? `Target repo: ${targetRepo}` : "",
    targetRepoUrl ? `Target repo URL: ${targetRepoUrl}` : "",
    workspacePath ? `Workspace path: ${workspacePath}` : "",
    contextFiles.length ? `Suggested context files: ${contextFiles.join(", ")}` : ""
  ].filter(Boolean).join("\n");
}

function buildCloudInput(command) {
  const text = normalizeText(command?.text, 12_000);
  const projectLabel = normalizeText(command?.projectLabel || command?.threadLabel || "Links", 160);
  const targetRepo = normalizeText(command?.targetRepo, 240);
  const prompt = [
    `Project: ${projectLabel}`,
    targetRepo ? `Repository: ${targetRepo}` : "",
    "",
    "User command:",
    text
  ].filter(Boolean).join("\n");

  const photoDataUrl = normalizeText(command?.photo?.dataUrl, 5_000_000);

  if (!photoDataUrl) {
    return prompt;
  }

  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: prompt
        },
        {
          type: "input_image",
          image_url: photoDataUrl
        }
      ]
    }
  ];
}

function buildCommandError(input) {
  return createCommandError(input);
}

function extractOutputText(payload) {
  const direct = normalizeText(payload?.output_text, 12_000);

  if (direct) {
    return direct;
  }

  const outputItems = Array.isArray(payload?.output) ? payload.output : [];
  const texts = [];

  for (const item of outputItems) {
    const content = Array.isArray(item?.content) ? item.content : [];

    for (const part of content) {
      if (String(part?.type || "").trim() === "output_text") {
        const text = normalizeText(part?.text, 12_000);

        if (text) {
          texts.push(text);
        }
      }
    }
  }

  return normalizeText(texts.join("\n\n"), 12_000);
}

export function getOpenAiCloudModel() {
  return OPENAI_CLOUD_MODEL;
}

export async function createOpenAiCloudResponse(env, command) {
  if (command?.photo && !normalizeText(command?.photo?.dataUrl, 5_000_000)) {
    return {
      ok: false,
      retryable: true,
      commandError: buildCommandError({
        code: "cloud_photo_missing_data",
        stage: "cloud-photo-missing-data",
        message: "Cloud photo command is missing image bytes.",
        detail: "The command reached cloud dispatch without a usable photo data URL.",
        executor: "cloud"
      })
    };
  }

  const apiKey = normalizeText(env?.OPENAI_API_KEY, 300);

  if (!apiKey) {
    return {
      ok: false,
      retryable: true,
      commandError: buildCommandError({
        code: "openai_api_key_missing",
        stage: "cloud-config-missing",
        message: "Cloud is not configured.",
        detail: "Set OPENAI_API_KEY in the Pages environment.",
        executor: "cloud"
      })
    };
  }

  const requestBody = {
    model: OPENAI_CLOUD_MODEL,
    instructions: buildCloudInstructions(command),
    input: buildCloudInput(command),
    text: {
      format: {
        type: "text"
      }
    }
  };

  let response;

  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
    });
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      commandError: buildCommandError({
        code: "openai_request_failed",
        stage: "cloud-request-failed",
        message: "Direct cloud request failed.",
        detail: error instanceof Error ? error.message : String(error),
        executor: "cloud"
      })
    };
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      retryable: response.status >= 500 || response.status === 429,
      commandError: buildCommandError({
        code: "openai_response_failed",
        stage: "cloud-response-failed",
        message: "Direct cloud request failed.",
        detail: String(data?.error?.message || `OpenAI returned HTTP ${response.status}.`).trim(),
        executor: "cloud"
      })
    };
  }

  const answerText = extractOutputText(data);

  if (!answerText) {
    return {
      ok: false,
      retryable: true,
      commandError: buildCommandError({
        code: "openai_empty_response",
        stage: "cloud-empty-response",
        message: "Direct cloud request returned no text.",
        detail: "The Responses API completed without a usable text output.",
        executor: "cloud"
      })
    };
  }

  return {
    ok: true,
    responseId: normalizeText(data?.id, 120),
    model: normalizeText(data?.model, 120) || OPENAI_CLOUD_MODEL,
    answerText,
    streamReady: true
  };
}
