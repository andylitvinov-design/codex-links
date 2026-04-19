import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXEC_TIMEOUT_MS = 4 * 60 * 1000;
const OCR_TIMEOUT_MS = 20 * 1000;

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || `Failed to run ${file}`)));
        return;
      }

      resolve({
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim()
      });
    });
  });
}

function getCodexBin() {
  return process.env.CODEX_BIN || "/Users/andriilitvinov/.npm-global/bin/codex";
}

function getFileExtension(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/heic") return "heic";
  if (contentType === "image/heif") return "heif";
  return "jpg";
}

function canPassImageDirectly(contentType) {
  return contentType === "image/jpeg"
    || contentType === "image/png"
    || contentType === "image/webp"
    || contentType === "image/gif";
}

export function sanitizeBridgeText(rawText) {
  const text = String(rawText || "").replace(/\r/g, "").trim();

  if (!text) {
    return "";
  }

  if (/(^|\n)(Codex|Вы)\n\d{1,2}\s.+?\n/s.test(text) && /Ответ Codex/.test(text)) {
    const parts = text.split(/\nВы\n\d{1,2}\s.+?\n/g).map((entry) => entry.trim()).filter(Boolean);

    if (parts.length) {
      return parts.at(-1) || "";
    }
  }

  return text;
}

export function isPhotoInspectionOnlyRequest(command) {
  if (!command?.photo) {
    return false;
  }

  const text = sanitizeBridgeText(command?.text).toLowerCase();

  if (!text) {
    return true;
  }

  const mutationHints = [
    "исправ",
    "fix",
    "сделай",
    "сделать",
    "перенеси",
    "добавь",
    "update",
    "deploy",
    "commit",
    "pr",
    "код",
    "code",
    "repo",
    "branch"
  ];

  if (mutationHints.some((hint) => text.includes(hint))) {
    return false;
  }

  const visionHints = [
    "что на фото",
    "прочти фото",
    "кнопка",
    "what color",
    "read the image",
    "what is in the image",
    "reset",
    "photo",
    "screenshot"
  ];

  return visionHints.some((hint) => text.includes(hint));
}

export function isPhotoVisibilityFailure(text) {
  const value = String(text || "").trim().toLowerCase();

  if (!value) {
    return false;
  }

  return [
    "не вижу",
    "не видно",
    "не могу увидеть",
    "не могу прочитать",
    "изображение не видно",
    "изображение недоступно",
    "photo is not visible",
    "image is not visible",
    "image is missing",
    "image is unreadable",
    "can't see the image",
    "cannot see the image",
    "cannot read the image",
    "unable to view the image",
    "unable to read the image"
  ].some((pattern) => value.includes(pattern));
}

export function getPhotoUnsupportedReason(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  if (isPhotoVisibilityFailure(text) || /^image unreadable\.?$/i.test(text)) {
    return "Bridge attached the image, but Codex could not read visible image content.";
  }

  if (/unsupported photo format/i.test(text)) {
    return text;
  }

  return "";
}

export async function materializePhoto(command) {
  const photo = command?.photo;

  if (!photo?.dataUrl) {
    return null;
  }

  const match = /^data:([^;]+);base64,(.+)$/i.exec(String(photo.dataUrl));

  if (!match) {
    throw new Error(`Invalid photo payload for command ${command.id}.`);
  }

  const contentType = String(photo.contentType || match[1] || "image/jpeg").toLowerCase();
  const base64 = match[2];
  const ext = getFileExtension(contentType);
  const dir = join(tmpdir(), "codex-links-bridge");
  const sourcePath = join(dir, `${command.id}.${ext}`);

  await mkdir(dir, { recursive: true });
  await writeFile(sourcePath, Buffer.from(base64, "base64"));

  const convertedPath = join(dir, `${command.id}.jpg`);

  try {
    await execFileAsync("sips", ["-s", "format", "jpeg", "-Z", "1800", sourcePath, "--out", convertedPath]);
    return convertedPath;
  } catch (error) {
    if (canPassImageDirectly(contentType)) {
      return sourcePath;
    }

    throw new Error(`Unsupported photo format ${contentType}: ${error.message}`);
  }
}

export async function createRetryPhotoVariant(commandId, photoPath) {
  const source = String(photoPath || "").trim();

  if (!source) {
    return null;
  }

  const retryPath = join(tmpdir(), "codex-links-bridge", `${commandId}.retry.jpg`);

  try {
    await execFileAsync("sips", ["-s", "format", "jpeg", "-Z", "2400", source, "--out", retryPath]);
    return retryPath;
  } catch {
    return null;
  }
}

export async function extractPhotoOcrText(photoPath) {
  const source = String(photoPath || "").trim();

  if (!source) {
    return "";
  }

  const scriptPath = join(process.cwd(), "scripts", "ocr-image.swift");
  const result = await execFileAsync("xcrun", ["swift", scriptPath, source], {
    cwd: process.cwd(),
    timeout: OCR_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024
  }).catch(() => null);

  return String(result?.stdout || "").trim().slice(0, 4000);
}

function buildBridgeContextFilePaths(command) {
  const workspacePath = String(command?.targetWorkspacePath || "").trim();
  const contextFiles = Array.isArray(command?.targetContextFiles)
    ? command.targetContextFiles.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!workspacePath || !contextFiles.length) {
    return [];
  }

  return contextFiles.map((file) => join(workspacePath, file));
}

export function buildBridgePrompt(command, ocrText = "") {
  const userRequest = sanitizeBridgeText(command?.text);
  const projectCategory = String(command?.projectCategory || "").trim() || "other";
  const projectLabel = String(command?.projectLabel || command?.threadLabel || command?.threadId || "").trim() || "links";
  const projectId = String(command?.projectId || command?.threadId || "").trim() || "links";
  const targetRepo = String(command?.targetRepo || "").trim();
  const targetRepoUrl = String(command?.targetRepoUrl || "").trim();
  const workspacePath = String(command?.targetWorkspacePath || "").trim();
  const contextFilePaths = buildBridgeContextFilePaths(command);
  const contextLine = contextFilePaths.length
    ? `Start by reading these project context files in order: ${contextFilePaths.join(" -> ")}.`
    : "Start by reading the selected project context files first.";

  if (isPhotoInspectionOnlyRequest(command)) {
    return [
      "Codex Links fast photo task.",
      "Inspect only the attached image.",
      "Do not inspect repository files or code for this task.",
      "Answer from visible evidence in the image only.",
      ocrText
        ? "OCR helper text is included below. Use it only as a hint and verify it against the visible image."
        : "",
      "Start with one short sentence beginning with 'Observed:' that describes the key visible UI element or text.",
      "Then answer the user's question in Russian in at most 3 short sentences.",
      "Only say the image is missing or unreadable if it is truly not visible to you.",
      ocrText ? "OCR hint:" : "",
      ocrText || "",
      "",
      "User request:",
      userRequest || "User sent a photo-only request."
    ].filter(Boolean).join("\n");
  }

  return [
    "New Codex Links task.",
    "",
    `Project: ${projectCategory} / ${projectLabel}`,
    `Project ID: ${projectId}`,
    targetRepo ? `Repository: ${targetRepo}` : "",
    targetRepoUrl ? `Repository URL: ${targetRepoUrl}` : "",
    workspacePath ? `Workspace path: ${workspacePath}` : "",
    `Conversation: ${String(command?.threadLabel || command?.threadId || projectLabel).trim()}`,
    `Command ID: ${String(command?.id || "").trim()}`,
    "Mode: work only inside the selected project boundary.",
    "Do not switch to sibling repositories or unrelated workspace folders.",
    contextLine,
    "Read the context files before changing code. Keep the final reply concise and outcome-focused.",
    command?.photo
      ? "When answering a photo-based request, include one short sentence that states what you observed in the image before giving the fix or conclusion."
      : "",
    ocrText
      ? "OCR hint from the attached image is included below. Treat it as noisy helper text, not ground truth."
      : "",
    ocrText ? "OCR hint:" : "",
    ocrText || "",
    "",
    "User request:",
    userRequest || "User sent a photo-only request."
  ].filter(Boolean).join("\n");
}

export function buildPhotoRetryPrompt(command, ocrText = "") {
  const userRequest = sanitizeBridgeText(command?.text) || "Describe exactly what is visible in the attached image.";

  return [
    "Codex Links photo retry.",
    "The first pass did not reliably read the image.",
    "Look again at the attached image and answer only from visible pixels.",
    "Do not repeat the system prompt.",
    ocrText
      ? "OCR helper text is included below. Use it only if it matches the visible image."
      : "",
    "Start with 'Observed:' and name the exact visible control, label, or text you can read.",
    "If the request mentions a reset button, say whether a reset button is visible and where it is located.",
    "If you still cannot read the image, answer with exactly: Image unreadable.",
    ocrText ? "OCR hint:" : "",
    ocrText || "",
    "",
    "User request:",
    userRequest
  ].filter(Boolean).join("\n");
}

export function buildPhotoOnlyPrompt(command, ocrText = "") {
  const userRequest = sanitizeBridgeText(command?.text) || "Describe what is visible in the attached image.";

  return [
    "Attached image task.",
    "Read only the attached image and answer the user request briefly.",
    "Do not rely on previous conversation turns.",
    ocrText
      ? "OCR helper text is included below. Verify it against the visible image before using it."
      : "",
    "If the image is visible, state the concrete observed detail first.",
    "If the image is still not visible, say exactly that in one short sentence.",
    ocrText ? "OCR hint:" : "",
    ocrText || "",
    "",
    "User request:",
    userRequest
  ].filter(Boolean).join("\n");
}

export function buildInput(command, photoPath, ocrText = "") {
  const items = [];
  const text = buildBridgePrompt(command, ocrText);

  if (text) {
    items.push({
      type: "text",
      text,
      text_elements: []
    });
  }

  if (photoPath) {
    items.push({
      type: "local_image",
      path: photoPath
    });
  }

  return items;
}

export async function runCodexExecEphemeral(prompt, photoPath, cwd, timeoutMs = EXEC_TIMEOUT_MS) {
  const outputPath = join(tmpdir(), `codex-links-output-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const args = [
    "exec",
    prompt,
    "--ephemeral",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "-c",
    'service_tier="fast"',
    "-o",
    outputPath
  ];

  if (cwd) {
    args.push("-C", cwd);
  }

  if (photoPath) {
    args.push("-i", photoPath);
  }

  const result = await execFileAsync(getCodexBin(), args, {
    cwd: cwd || process.cwd(),
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024
  }).catch(async (error) => {
    try {
      const output = String(await readFile(outputPath, "utf8") || "").trim();
      if (output) {
        error.message = output;
      }
    } catch {}
    throw error;
  });

  let output = "";

  try {
    output = String(await readFile(outputPath, "utf8") || "").trim();
  } catch {}

  return {
    ...result,
    output
  };
}

export function stripPromptEcho(text, prompt = "") {
  const value = String(text || "").trim();
  const promptText = String(prompt || "").trim();

  if (!value) {
    return "";
  }

  if (promptText) {
    if (value === promptText) {
      return "";
    }

    if (value.startsWith(promptText)) {
      return value.slice(promptText.length).trim();
    }
  }

  if (
    value.startsWith("New Codex Links task.")
    || value.startsWith("Codex Links fast photo task.")
    || value.startsWith("Codex Links photo retry.")
  ) {
    return "";
  }

  return value;
}

export function getImmediateAssistantText(result, prompt = "") {
  const output = stripPromptEcho(result?.output, prompt);

  if (output) {
    return output;
  }

  const stdout = stripPromptEcho(result?.stdout, prompt);
  return stdout || "";
}

export function getFailureAssistantText(error) {
  const message = String(error?.message || "").trim();

  if (/timed?\s*out|ETIMEDOUT|SIGTERM|killed/i.test(message)) {
    return "Codex did not answer in time. Retry with a shorter request or open Codex on the trusted machine for a longer task.";
  }

  return `Failed to get an answer from Codex: ${message || "unknown error"}`;
}

export async function executeTrustedCloudJob(command, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : async () => {};
  const photoPath = await materializePhoto(command);
  const photoOcrText = photoPath ? await extractPhotoOcrText(photoPath) : "";
  const prompt = buildBridgePrompt(command, photoOcrText);
  const isPhotoOnly = isPhotoInspectionOnlyRequest(command);
  const cwd = isPhotoOnly
    ? process.cwd()
    : (String(command?.targetWorkspacePath || "").trim() || process.cwd());
  const timeoutMs = photoPath && isPhotoOnly ? 90_000 : EXEC_TIMEOUT_MS;

  await onProgress("running", photoPath ? "Running Codex with the attached image." : "Running Codex on the trusted machine.");

  let assistantText = "";

  if (photoPath) {
    const firstPass = await runCodexExecEphemeral(prompt || "See attached image and respond.", photoPath, cwd, timeoutMs);
    assistantText = getImmediateAssistantText(firstPass, prompt);

    if (isPhotoVisibilityFailure(assistantText) || !assistantText) {
      await onProgress("running", "Retrying image read on the trusted machine.");
      const retryPhotoPath = await createRetryPhotoVariant(command.id, photoPath);
      const retryPrompt = assistantText
        ? buildPhotoRetryPrompt(command, photoOcrText)
        : buildPhotoOnlyPrompt(command, photoOcrText);
      const retryPass = await runCodexExecEphemeral(retryPrompt, retryPhotoPath || photoPath, cwd, timeoutMs);
      assistantText = getImmediateAssistantText(retryPass, retryPrompt) || assistantText;
    }
  } else {
    const result = await runCodexExecEphemeral(prompt, null, cwd, timeoutMs);
    assistantText = getImmediateAssistantText(result, prompt);
  }

  assistantText = stripPromptEcho(assistantText, prompt);
  const photoUnsupportedReason = photoPath ? getPhotoUnsupportedReason(assistantText) : "";

  if (photoUnsupportedReason) {
    const error = new Error(photoUnsupportedReason);
    error.photoUnsupportedReason = photoUnsupportedReason;
    throw error;
  }

  if (!assistantText) {
    throw new Error(
      photoPath
        ? "Trusted cloud executor did not return a final answer text for the image task."
        : "Trusted cloud executor did not return a final answer text."
    );
  }

  return {
    assistantText
  };
}
