import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBridgePrompt,
  buildPhotoOnlyPrompt,
  selectPrimaryBridgePrompt
} from "../scripts/_lib/bridge-prompts.mjs";

function createCommand(overrides = {}) {
  return {
    id: "command-1",
    text: "",
    photo: {
      contentType: "image/png",
      dataUrl: "data:image/png;base64,AAAA"
    },
    projectCategory: "myprojects",
    projectLabel: "links",
    projectId: "links",
    threadId: "links",
    threadLabel: "links",
    targetRepo: "andylitvinov-design/codex-links",
    targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
    targetWorkspacePath: "/workspace/links",
    targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
    ...overrides
  };
}

test("selectPrimaryBridgePrompt keeps photo-only mode for image-only commands", () => {
  const command = createCommand();

  assert.equal(selectPrimaryBridgePrompt(command), buildPhotoOnlyPrompt(command));
});

test("selectPrimaryBridgePrompt uses full bridge prompt for mixed text and photo commands", () => {
  const command = createCommand({
    text: "Исправь баг на основе этого скриншота"
  });

  const prompt = selectPrimaryBridgePrompt(command, "OCR sample");

  assert.equal(prompt, buildBridgePrompt(command, "OCR sample"));
  assert.match(prompt, /Start by reading these project context files in order:/);
  assert.match(prompt, /Use the user's text request together with visible evidence from the image\./);
  assert.match(prompt, /User request:\nИсправь баг на основе этого скриншота/);
  assert.doesNotMatch(prompt, /^Attached image task\./m);
});
