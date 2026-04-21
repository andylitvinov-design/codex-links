const GENERIC_CODEX_ERROR_MESSAGE = "Не удалось получить читаемую ошибку от Codex. Повторите запрос ещё раз.";

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function looksLikeCodexCliDump(value) {
  const text = String(value || "");

  return /OpenAI Codex v\d/i.test(text)
    || (/provider:\s*openai/i.test(text) && /sandbox:\s*/i.test(text))
    || /session id:\s*[0-9a-f-]{8,}/i.test(text)
    || /-----\s*user\b/i.test(text);
}

export function sanitizeCodexErrorMessage(rawValue) {
  const raw = String(rawValue || "").trim();

  if (!raw) {
    return "";
  }

  if (!looksLikeCodexCliDump(raw)) {
    return raw;
  }

  const withoutHeader = raw
    .replace(/^OpenAI Codex[^\n]*\n?/i, "")
    .replace(/^-- workdir:[^\n]*\n?/im, "")
    .replace(/^model:[^\n]*\n?/im, "")
    .replace(/^reasoning effort:[^\n]*\n?/im, "")
    .replace(/^-----\s*user\b[\s:-]*/im, "");
  const collapsed = collapseWhitespace(withoutHeader);

  if (!collapsed || looksLikeCodexCliDump(collapsed) || /^Codex Links photo retry\./i.test(collapsed)) {
    return GENERIC_CODEX_ERROR_MESSAGE;
  }

  return collapsed;
}

export { GENERIC_CODEX_ERROR_MESSAGE };
