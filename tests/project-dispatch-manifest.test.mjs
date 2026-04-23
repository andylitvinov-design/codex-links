import test from "node:test";
import assert from "node:assert/strict";

import {
  findProjectTargetById,
  listVisibleProjectTargets,
  resolveProjectDispatchTarget
} from "../functions/_lib/project-dispatch-manifest.js";

test("dispatch manifest exposes ezohata_ads as a visible cloud-ready project", () => {
  const project = findProjectTargetById("ezohata_ads");

  assert.ok(project, "expected ezohata_ads project in dispatch manifest");
  assert.equal(project.targetRepo, "andylitvinov-design/ezohata_ads");
  assert.equal(project.targetRepoUrl, "https://github.com/andylitvinov-design/ezohata_ads");
  assert.equal(project.workspacePath, "/Users/andriilitvinov/projects/MYPROJECTS/ezohata_ads");
});

test("visible repos feed includes ezohata_ads as cloud-ready", () => {
  const { repos } = listVisibleProjectTargets();
  const project = repos.find((entry) => entry.id === "ezohata_ads");

  assert.ok(project, "expected ezohata_ads in visible repo list");
  assert.equal(project.cloudReady, true);
  assert.equal(project.statusLabel, "cloud-ready");
});

test("command dispatch resolution keeps ezohata_ads on its dedicated repository", () => {
  const result = resolveProjectDispatchTarget({
    threadId: "ezohata_ads",
    dispatchMode: "slack-codex-cloud"
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.targetRepo, "andylitvinov-design/ezohata_ads");
  assert.equal(result.value.targetRepoUrl, "https://github.com/andylitvinov-design/ezohata_ads");
});
