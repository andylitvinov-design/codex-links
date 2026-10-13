import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateRelease, readRelease, verifyProduction } from "../scripts/verify-production-release.mjs";

function fixture(build = "20261012-2016") {
  return {
    "version.json": JSON.stringify({ build }),
    "app.js": `const BUILD_VERSION = "${build}";`,
    "index.html": `var build = "${build}";<script src="/app.js?v=${build}"></script><link href="/styles.css?v=${build}">`,
  };
}
function mock(files, calls = [], status = 200) {
  return async (url, options) => {
    calls.push({ url, options });
    const name = new URL(url).pathname.slice(1) || "index.html";
    assert.ok(Object.hasOwn(files, name), "unexpected network target");
    return { ok: status === 200, status, text: async () => files[name] };
  };
}

test("local real release triplet is aligned", async () => {
  const local = await readRelease();
  assert.match(local.build, /^\d{8}-\d{4}$/);
});
test("valid synthetic release markers pass", () => {
  assert.equal(validateRelease(fixture()), "20261012-2016");
});
for (const build of [undefined, null, 123, "", "20261012-2016\nbad=1", "../other"]) {
  test(`invalid build marker rejected: ${JSON.stringify(build)}`, () => {
    assert.throws(() => validateRelease(fixture(build === undefined ? "invalid" : build)));
  });
}
test("malformed version JSON rejected", () => {
  assert.throws(() => validateRelease({ ...fixture(), "version.json": "not JSON" }));
});
test("missing version marker rejected", () => {
  assert.throws(() => validateRelease({ ...fixture(), "version.json": "{}" }), /Invalid/);
});
for (const name of ["app.js", "index.html"]) {
  test(`${name} marker mismatch rejected`, () => {
    const files = fixture();
    files[name] = fixture("20260516-1306")[name];
    assert.throws(() => validateRelease(files), /disagree/);
  });
}
for (const name of ["app.js", "styles.css"]) {
  test(`${name} cache-busting mismatch rejected`, () => {
    const files = fixture();
    files["index.html"] = files["index.html"].replace(`/${name}?v=20261012-2016`, `/${name}?v=old`);
    assert.throws(() => validateRelease(files), /disagree/);
  });
}
test("production verifier reads only fixed static URLs with no redirects", async () => {
  const files = fixture();
  const calls = [];
  assert.equal(await verifyProduction({ build: validateRelease(files), files }, { fetchImpl: mock(files, calls), nonce: 123 }), "20261012-2016");
  assert.deepEqual(calls.map(x => x.url), ["version.json", "app.js", ""].map(name => `https://codex-links.pages.dev/${name}?release_check=123`));
  for (const { options } of calls) {
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
  }
});
test("stale but internally aligned production fails", async () => {
  const files = fixture();
  await assert.rejects(verifyProduction({ build: validateRelease(files), files }, { fetchImpl: mock(fixture("20260516-1306")) }), /does not match/);
});
test("same build with different app bytes fails", async () => {
  const files = fixture();
  await assert.rejects(verifyProduction({ build: validateRelease(files), files }, { fetchImpl: mock({ ...files, "app.js": files["app.js"] + "\nchanged" }) }), /static file differs/);
});
test("HTTP failures fail closed", async () => {
  const files = fixture();
  await assert.rejects(verifyProduction({ build: validateRelease(files), files }, { fetchImpl: mock(files, [], 500) }), /HTTP 500/);
});
test("network failures fail closed", async () => {
  const files = fixture();
  await assert.rejects(verifyProduction({ build: validateRelease(files), files }, { fetchImpl: async () => { throw new Error("network unavailable"); } }), /network unavailable/);
});
test("workflow isolates deploy credentials and checks exact main", async () => {
  const yaml = await readFile(new URL("../.github/workflows/deploy-production.yml", import.meta.url), "utf8");
  const [validation, deployment] = yaml.split("  deploy-production:\n");
  assert.ok(deployment);
  assert.equal(validation.includes("secrets."), false);
  assert.equal(yaml.includes("actions/checkout"), false);
  assert.equal(yaml.includes("deployments: write"), false);
  assert.match(deployment, /needs: validate-release/);
  const [beforeSecrets, afterSecrets] = deployment.split("      # Only this step receives");
  assert.equal(beforeSecrets.includes("secrets."), false);
  const secretStep = afterSecrets.split("      # Fetch static assets only.")[0];
  assert.equal((yaml.match(/secrets\.CLOUDFLARE_/g) || []).length, 2);
  assert.equal((secretStep.match(/secrets\.CLOUDFLARE_/g) || []).length, 2);
  assert.match(secretStep, /--branch main --commit-hash "\$EXPECTED_SHA"/);
  assert.match(yaml, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(yaml, /test "\$TARGET_REF" = main/);
  assert.match(yaml, /test "\$REMOTE_SHA" = "\$EXPECTED_SHA"/);
  assert.equal(yaml.includes("${{ inputs.reason }}"), true);
  for (const run of yaml.split("        run: |\n").slice(1)) {
    const body = run.split(/\n      (?:- name:|#)/)[0];
    assert.equal(body.includes("${{ inputs."), false, "dispatch input must not be interpolated into shell source");
  }
});
