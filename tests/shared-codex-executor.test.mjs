import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyTrustedCloudFailure,
  getFailureAssistantText,
  getImmediateAssistantText,
  stripPromptEcho
} from "../scripts/shared-codex-executor.mjs";

test("stripPromptEcho removes pure trusted-cloud prompt echoes", () => {
  assert.equal(stripPromptEcho("New Codex Links task.\nDo the work."), "");
  assert.equal(stripPromptEcho("Codex Links fast photo task.\nInspect the image."), "");
});

test("stripPromptEcho preserves final text after trusted-cloud prompt echoes", () => {
  const output = [
    "New Codex Links task.",
    "Do the work.",
    "",
    "CLOUD_SMOKE_OK"
  ].join("\n");

  assert.equal(stripPromptEcho(output), "CLOUD_SMOKE_OK");
});

test("getImmediateAssistantText falls back to stdout when output is only an echo", () => {
  const result = {
    output: "New Codex Links task.\nDo the work.",
    stdout: "CLOUD_SMOKE_OK"
  };

  assert.equal(getImmediateAssistantText(result, "Do the work."), "CLOUD_SMOKE_OK");
});

test("getFailureAssistantText keeps photo visibility failures explicit", () => {
  const error = new Error("Bridge attached the image, but Codex could not read visible image content.");
  error.photoUnsupportedReason = error.message;

  assert.equal(classifyTrustedCloudFailure(error), "cloud_bridge_photo_not_visible");
  assert.equal(getFailureAssistantText(error), "PHOTO_NOT_VISIBLE");
});

test("classifyTrustedCloudFailure distinguishes timeout and no-final-answer cases", () => {
  assert.equal(
    classifyTrustedCloudFailure(new Error("The operation was aborted due to timeout")),
    "cloud_bridge_timeout"
  );
  assert.equal(
    classifyTrustedCloudFailure(new Error("Trusted cloud executor did not return a final answer text.")),
    "cloud_bridge_no_final_answer"
  );
});
