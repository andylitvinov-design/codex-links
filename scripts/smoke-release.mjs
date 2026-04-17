#!/usr/bin/env node

import { readFile } from "node:fs/promises";

async function main() {
  const [versionRaw, appJs, indexHtml, manifestRaw, readme] = await Promise.all([
    readFile(new URL("../public/version.json", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../ops/deployment-manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8")
  ]);

  const build = JSON.parse(versionRaw).build;
  const manifest = JSON.parse(manifestRaw);
  const failures = [];

  if (!build) {
    failures.push("public/version.json must expose a build id.");
  }

  if (!appJs.includes(`const BUILD_VERSION = "${build}"`)) {
    failures.push("public/app.js BUILD_VERSION does not match public/version.json.");
  }

  if (!appJs.includes("if (await ensureLatestClient()) {")) {
    failures.push("public/app.js must trigger ensureLatestClient before polling or boot refresh.");
  }

  if (!appJs.includes("document.addEventListener(\"visibilitychange\"")) {
    failures.push("public/app.js must re-check the latest build when the tab becomes visible.");
  }

  if (!indexHtml.includes(`/styles.css?v=${build}`) || !indexHtml.includes(`/app.js?v=${build}`)) {
    failures.push("public/index.html asset cache-busting parameters do not match the build id.");
  }

  if (manifest.productionBranch !== "main") {
    failures.push("ops/deployment-manifest.json must keep productionBranch=main.");
  }

  if (!readme.includes("branch -> PR -> merge -> Pages deploy")) {
    failures.push("README.md must document the branch -> PR -> merge -> deploy flow.");
  }

  if (failures.length) {
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`codex-links release smoke checks passed for build ${build}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
