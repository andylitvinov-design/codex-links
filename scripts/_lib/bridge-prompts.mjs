import { join } from "node:path";

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

export function hasBridgeUserText(command) {
  return Boolean(sanitizeBridgeText(command?.text));
}

export function buildBridgeContextFilePaths(command) {
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

  if (command?.photo) {
    return [
      "New Codex Links bridge task with attached image.",
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
      "Inspect the attached image before answering any image-specific part of the request.",
      "Use the user's text request together with visible evidence from the image.",
      ocrText
        ? "OCR helper text is included below. Use it only as a hint and verify it against the visible image."
        : "",
      "When the answer depends on the image, start with one short sentence beginning with 'Observed:'.",
      "Delivery rule: read the context files before changing code, then respond in the same conversation.",
      ocrText ? "" : "",
      ocrText ? "OCR hint:" : "",
      ocrText || "",
      "",
      "User request:",
      userRequest || "User sent a photo-only request."
    ].filter(Boolean).join("\n");
  }

  return [
    "New Codex Links bridge task.",
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
    "Delivery rule: read the context files before changing code, then respond in the same conversation.",
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
    ocrText ? "" : "",
    ocrText ? "OCR hint:" : "",
    ocrText || "",
    "",
    "User request:",
    userRequest
  ].join("\n");
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
    ocrText ? "" : "",
    ocrText ? "OCR hint:" : "",
    ocrText || "",
    "",
    "User request:",
    userRequest
  ].join("\n");
}

export function selectPrimaryBridgePrompt(command, ocrText = "") {
  return hasBridgeUserText(command)
    ? buildBridgePrompt(command, ocrText)
    : buildPhotoOnlyPrompt(command, ocrText);
}
