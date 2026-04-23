export const BRIDGE_EXEC_TIMEOUT_MS = 4 * 60 * 1000;
export const BRIDGE_PHOTO_EXEC_TIMEOUT_MS = 5 * 60 * 1000;

export function hasAttachedPhoto(command = {}) {
  if (command?.photo && typeof command.photo === "object") {
    return Boolean(command.photo.dataUrl || command.photo.hasDataUrl);
  }

  return Boolean(command?.photoAttached && command?.photoBytesPresent);
}

export function getBridgeExecTimeoutMs(command = {}) {
  return hasAttachedPhoto(command)
    ? BRIDGE_PHOTO_EXEC_TIMEOUT_MS
    : BRIDGE_EXEC_TIMEOUT_MS;
}
