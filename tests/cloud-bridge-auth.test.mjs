import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBridgeCanonicalString,
  sha256Hex,
  signBridgeRequest,
  verifyBridgeRequestSignature
} from "../scripts/cloud-bridge-auth.mjs";

test("cloud bridge auth verifies signed requests", () => {
  const bodyText = JSON.stringify({ command: { id: "cmd-1" } });
  const timestamp = new Date().toISOString();
  const bodySha256 = sha256Hex(bodyText);
  const signature = signBridgeRequest("secret", {
    method: "POST",
    path: "/v1/commands",
    timestamp,
    bodySha256
  });

  assert.equal(
    buildBridgeCanonicalString("POST", "/v1/commands", timestamp, bodySha256),
    `POST\n/v1/commands\n${timestamp}\n${bodySha256}`
  );

  const verified = verifyBridgeRequestSignature({
    secret: "secret",
    method: "POST",
    path: "/v1/commands",
    timestamp,
    bodyText,
    signature,
    bodySha256
  });

  assert.equal(verified.ok, true);
});

test("cloud bridge auth rejects invalid signatures", () => {
  const bodyText = JSON.stringify({ command: { id: "cmd-1" } });
  const bodySha256 = sha256Hex(bodyText);

  const verified = verifyBridgeRequestSignature({
    secret: "secret",
    method: "POST",
    path: "/v1/commands",
    timestamp: new Date().toISOString(),
    bodyText,
    signature: "bad-signature",
    bodySha256
  });

  assert.equal(verified.ok, false);
  assert.match(String(verified.error || ""), /invalid/i);
});
