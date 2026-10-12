// Verify the exact registry resolution before any browser execution; never reads provider config.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const lock = JSON.parse(await readFile(new URL("./package-lock.json", import.meta.url), "utf8"));
assert.equal(lock.lockfileVersion, 3);
const dependencies = {};
for (const name of ["playwright", "playwright-core"]) {
  const entry = lock.packages[`node_modules/${name}`];
  assert.equal(entry?.version, "1.62.1");
  assert.equal(entry.resolved, `https://registry.npmjs.org/${name}/-/${name}-1.62.1.tgz`);
  assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  const installed = JSON.parse(await readFile(new URL(`./node_modules/${name}/package.json`, import.meta.url), "utf8"));
  assert.equal(installed.version, entry.version);
  dependencies[name] = { version: entry.version, resolved: entry.resolved, integrity: entry.integrity };
}
assert.equal(lock.packages[""].devDependencies.playwright, "1.62.1");
const browsers = JSON.parse(await readFile(new URL("./node_modules/playwright-core/browsers.json", import.meta.url), "utf8"));
const output = new URL("../../browser-acceptance-results/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("dependency-resolution.json", output), JSON.stringify({
  result: "resolved-exact-version",
  dependencies,
  browsers: browsers.browsers.filter(browser => browser.name.includes("chromium")),
  note: "Registry-generated lock and npm integrity validation captured during CI; not independently pre-fetched before publication."
}, null, 2) + "\n");
console.log("Exact Playwright 1.62.1 dependency versions and official registry integrity recorded.");
