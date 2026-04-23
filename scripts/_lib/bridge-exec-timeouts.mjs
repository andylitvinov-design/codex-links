export const BRIDGE_EXEC_TIMEOUT_MS = 3 * 60 * 1000;
export const BRIDGE_LONG_TEXT_EXEC_TIMEOUT_MS = 8 * 60 * 1000;
export const BRIDGE_PHOTO_EXEC_TIMEOUT_MS = 20 * 60 * 1000;
export const BRIDGE_LONG_TEXT_THRESHOLD = 500;

export function hasAttachedPhoto(command = {}) {
  if (command?.photo && typeof command.photo === "object") {
    return Boolean(command.photo.dataUrl || command.photo.hasDataUrl);
  }

  return Boolean(command?.photoAttached && command?.photoBytesPresent);
}

export function hasLongBridgeText(command = {}) {
  return String(command?.text || "").trim().length > BRIDGE_LONG_TEXT_THRESHOLD;
}

export function getBridgeExecTimeoutMs(command = {}) {
  if (hasAttachedPhoto(command)) {
    return BRIDGE_PHOTO_EXEC_TIMEOUT_MS;
  }

  if (hasLongBridgeText(command)) {
    return BRIDGE_LONG_TEXT_EXEC_TIMEOUT_MS;
  }

  return BRIDGE_EXEC_TIMEOUT_MS;
}
