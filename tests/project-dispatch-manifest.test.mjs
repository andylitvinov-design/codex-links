import test from "node:test";
import assert from "node:assert/strict";

import {
  findProjectTargetById,
  listVisibleProjectTargets,
  resolveProjectDispatchTarget
} from "../functions/_lib/project-dispatch-manifest.js";
import { buildSlackCommandPrompt } from "../functions/_lib/prompt-builder.js";

test("dispatch manifest exposes links with repo context and deploy metadata", () => {
  const project = findProjectTargetById("links");

  assert.ok(project, "expected links project in dispatch manifest");
  assert.equal(project.targetRepo, "andylitvinov-design/codex-links");
  assert.equal(project.targetRepoUrl, "https://github.com/andylitvinov-design/codex-links");
  assert.equal(project.workspacePath, "/Users/andriilitvinov/projects/MYPROJECTS/links");
  assert.deepEqual(project.contextFiles, ["AGENTS.md", "README.md", "STATE.md"]);
  assert.equal(project.cloudReady, true);
  assert.equal(project.statusLabel, "cloud-ready");
});

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

test("command dispatch resolution keeps links on codex-links and builds repo-aware prompt", () => {
  const result = resolveProjectDispatchTarget({
    threadId: "links",
    dispatchMode: "slack-codex-cloud",
    text: "check routing"
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.targetRepo, "andylitvinov-design/codex-links");
  assert.match(result.value.workspacePath, /links/);

  const prompt = buildSlackCommandPrompt({
    id: "cmd-links-routing",
    threadId: "links",
    threadLabel: "links",
    projectId: result.value.id,
    projectLabel: result.value.label,
    projectCategory: result.value.group,
    targetRepo: result.value.targetRepo,
    targetRepoUrl: result.value.targetRepoUrl,
    targetWorkspacePath: result.value.workspacePath,
    targetContextFiles: result.value.contextFiles,
    text: "check routing"
  }, {
    SLACK_CODEX_MENTION: "<@U999>"
  });

  assert.match(prompt, /Repository: andylitvinov-design\/codex-links/);
  assert.match(prompt, /Project Key: links/);
  assert.match(prompt, /ACK repo=andylitvinov-design\/codex-links project=links command=cmd-links-routing/);
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

test("dispatch manifest resolves finance aliases to the finance repository", () => {
  const project = findProjectTargetById("ezohata-ledger");

  assert.ok(project, "expected ezohata-ledger alias to resolve");
  assert.equal(project.id, "finance");
  assert.equal(project.projectKey, "finance");
  assert.equal(project.targetRepo, "andylitvinov-design/finance");
  assert.equal(project.codexEnvironmentName, "finance");
  assert.equal(project.codexEnvironmentId, "needs-verification");
});

test("projectKey wins over threadId when resolving a command target", () => {
  const result = resolveProjectDispatchTarget({
    projectKey: "reiki-yggdrasil",
    threadId: "links",
    dispatchMode: "cloud-via-slack",
    text: "Audit the layout and report issues without changing production."
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.projectKey, "reiki-yggdrasil");
  assert.equal(result.value.targetRepo, "andylitvinov-design/reiki-yggdrasil");
  assert.equal(result.value.codexEnvironmentName, "reiki-yggdrasil");
  assert.equal(result.value.codexEnvironmentVerified, false);
});

test("unknown cloud project is rejected before dispatch", () => {
  const result = resolveProjectDispatchTarget({
    projectKey: "missing-project",
    dispatchMode: "cloud-via-slack",
    text: "Run a cloud task."
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /dispatch manifest/i);
});

test("visible project list exposes Codex Cloud diagnostics", () => {
  const { repos } = listVisibleProjectTargets();
  const reiki = repos.find((repo) => repo.projectKey === "reiki-yggdrasil");

  assert.ok(reiki, "expected reiki-yggdrasil in visible project list");
  assert.equal(reiki.targetRepo, "andylitvinov-design/reiki-yggdrasil");
  assert.equal(reiki.codexCloud.environmentName, "reiki-yggdrasil");
  assert.equal(reiki.codexCloud.environmentId, "needs-verification");
  assert.deepEqual(reiki.allowedActions, ["audit", "fix", "test", "design-check"]);
});
