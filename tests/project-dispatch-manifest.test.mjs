import test from "node:test";
import assert from "node:assert/strict";

import {
  findProjectTargetById,
  listVisibleProjectTargets,
  resolveProjectDispatchTarget
} from "../functions/_lib/project-dispatch-manifest.js";

test("dispatch manifest exposes ezohata as a visible cloud-ready project", () => {
  const project = findProjectTargetById("ezohata");

  assert.ok(project, "expected ezohata project in dispatch manifest");
  assert.equal(project.targetRepo, "andylitvinov-design/ezohata");
  assert.equal(project.targetRepoUrl, "https://github.com/andylitvinov-design/ezohata");
  assert.equal(project.workspacePath, "/Users/andriilitvinov/projects/MYPROJECTS/ezohata");
  assert.equal(project.cloudReady, true);
});

test("command dispatch resolution keeps ezohata on its dedicated repository", () => {
  const result = resolveProjectDispatchTarget({
    threadId: "ezohata",
    dispatchMode: "slack-codex-cloud"
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.targetRepo, "andylitvinov-design/ezohata");
  assert.equal(result.value.targetRepoUrl, "https://github.com/andylitvinov-design/ezohata");
});

test("visible repos feed includes ezohata as cloud-ready", () => {
  const { repos } = listVisibleProjectTargets();
  const project = repos.find((entry) => entry.id === "ezohata");

  assert.ok(project, "expected ezohata in visible repo list");
  assert.equal(project.cloudReady, true);
  assert.equal(project.statusLabel, "cloud-ready");
});

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

test("links exposes deploy metadata for production-verifiable cloud tasks", () => {
  const result = resolveProjectDispatchTarget({
    threadId: "links",
    dispatchMode: "slack-codex-cloud",
    text: "fix the production site"
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.productionVerifiable, true);
  assert.equal(result.value.deploy.productionUrl, "https://codex-links.pages.dev/");
  assert.equal(result.value.deploy.productionBranch, "main");
});

test("production-changing cloud tasks require deploy metadata", () => {
  const result = resolveProjectDispatchTarget({
    threadId: "ezohata_ads",
    dispatchMode: "slack-codex-cloud",
    text: "fix the production site and deploy it"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "setup-needed");
  assert.match(result.error, /needs deploy metadata/);
});
