import test from "node:test";
import assert from "node:assert/strict";

import {
  BRIDGE_EXEC_TIMEOUT_MS,
  BRIDGE_PHOTO_EXEC_TIMEOUT_MS,
  getBridgeExecTimeoutMs
} from "../scripts/_lib/bridge-exec-timeouts.mjs";

test("getBridgeExecTimeoutMs keeps default timeout for text-only bridge commands", () => {
  assert.equal(getBridgeExecTimeoutMs({ photo: null }), BRIDGE_EXEC_TIMEOUT_MS);
  assert.equal(getBridgeExecTimeoutMs({ photoAttached: false }), BRIDGE_EXEC_TIMEOUT_MS);
});

test("getBridgeExecTimeoutMs uses longer timeout for commands with attached photo bytes", () => {
  assert.equal(getBridgeExecTimeoutMs({
    photo: {
      dataUrl: "data:image/png;base64,AAAA"
    }
  }), BRIDGE_PHOTO_EXEC_TIMEOUT_MS);

  assert.equal(getBridgeExecTimeoutMs({
    photoAttached: true,
    photoBytesPresent: true
  }), BRIDGE_PHOTO_EXEC_TIMEOUT_MS);
});
