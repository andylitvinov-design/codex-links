// Real-browser acceptance uses only a loopback fixture server. Run inside a network namespace.
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir, networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

const playwrightPackage = JSON.parse(await readFile(new URL("./node_modules/playwright/package.json", import.meta.url), "utf8"));
assert.equal(playwrightPackage.version, "1.62.1", "Acceptance requires the reviewed exact Playwright version.");

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const addresses = Object.values(networkInterfaces()).flat().filter(Boolean);
assert.ok(addresses.some(address => address.address === "127.0.0.1"), "Loopback must be enabled.");
assert.ok(addresses.every(address => address.internal), "Run acceptance in a loopback-only network namespace.");
const output = resolve(root, "browser-acceptance-results");
await mkdir(output, {recursive: true});
const build = JSON.parse(await readFile(resolve(root, "public/version.json"), "utf8")).build;
const now = new Date().toISOString();
const clients = ["phone-uuid", "desktop-uuid", "telegram:123"];
const commands = clients.map((clientId, i) => ({
  id: "fixture-command-" + i, clientId, threadId: "fixture-project", threadLabel: "Fixture Project",
  text: "Task from " + clientId, createdAt: now, progressUpdatedAt: now,
  status: "queued", progressStage: "queued", dispatchMode: "local-bridge", uiVisibleAt: now
}));
// Keep one completed historical item outside activeOnly, as the real endpoint does.
commands[1] = {...commands[1], status:"answered", progressStage:"answered", createdAt:new Date(Date.now()-120_000).toISOString(), progressUpdatedAt:new Date(Date.now()-120_000).toISOString()};
const messages = commands.map(command => ({
  id: command.id + "-reply", clientId: command.clientId, commandId: command.id,
  threadId: command.threadId, threadLabel: command.threadLabel, role: "assistant",
  text: "Reply for " + command.clientId, createdAt: now
}));
const repo = {id:"fixture-project",repoId:"fixture-project",label:"Fixture Project",displayLabel:"Fixture Project",category:"other",cloudReady:false};
const status = {
  dispatchMode:"local-bridge", executorLabel:"Fixture bridge", state:"running", bridgeOnline:true,
  localBridge:{online:true,managedBy:"launchd",lastRunAt:now,state:"running"},
  routes:{localBridge:{state:"healthy",enabled:true},cloudViaSlack:{state:"unavailable",enabled:false},directOpenai:{state:"unavailable",enabled:false},claudeBridge:{state:"unavailable",enabled:false}}
};
let mode = "normal";
let active = 0;
let maxActive = 0;
let aborted = 0;
let submitCount = 0;
let markActiveResponse = false;
const held = new Set();
const events = [];
const checks = [];
const external = [];
const pageErrors = [];
const snapshot = (activeOnly) => {
  const selected = activeOnly ? commands.filter(command => ["queued","dispatched","processing"].includes(command.status) || Date.now()-Date.parse(command.createdAt)<=30_000 || Date.now()-Date.parse(command.progressUpdatedAt)<=30_000) : commands;
  const ids = new Set(selected.map(command=>command.id));
  const outputCommands=structuredClone(selected);
  if(activeOnly && markActiveResponse) {
    const phone=outputCommands.find(command=>command.id==="fixture-command-0");
    if(phone){phone.text="Active-only response applied";phone.progressUpdatedAt=new Date().toISOString();}
  }
  return {commands:outputCommands,messages:structuredClone(activeOnly ? messages.filter(message=>ids.has(message.commandId)) : messages),reports:[],status:structuredClone(status),serverTime:new Date().toISOString()};
};
function json(res, value, code = 200) {
  res.writeHead(code, {"content-type":"application/json","cache-control":"no-store"});
  res.end(JSON.stringify(value));
}
const files = new Map([
  ["/","index.html"],["/index.html","index.html"],["/app.js","app.js"],["/styles.css","styles.css"],["/version.json","version.json"],
  ["/_lib/command-error-utils.js","_lib/command-error-utils.js"],["/_lib/photo-prep.js","_lib/photo-prep.js"],["/_lib/report-ui-utils.js","_lib/report-ui-utils.js"]
]);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/delivery") {
      assert.equal(url.searchParams.get("scope"), "public", "Browser must preserve the shared feed.");
      const data = snapshot(url.searchParams.get("activeOnly")==="1");
      const event = {kind:"delivery",mode,at:Date.now(),activeOnly:url.searchParams.get("activeOnly")==="1"};
      events.push(event); active++; maxActive=Math.max(maxActive,active);
      let finished=false;
      const done=()=>{if (!finished) {finished=true;active--;held.delete(item);if (!res.writableEnded) aborted++;}};
      const item={res,data}; res.on("close",done);
      if (mode === "normal") json(res,data);
      else held.add(item);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/repos") return json(res,[repo]);
    if (req.method === "POST" && url.pathname === "/api/commands") {
      const chunks=[];for await (const chunk of req)chunks.push(chunk);
      const input=JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if(input.action==="visible") return json(res,{ok:true});
      assert.equal(input.text,"Acceptance new command");
      assert.equal(input.clientId,"phone-uuid");
      submitCount++;events.push({kind:"submit",at:Date.now()});
      const createdAt=new Date().toISOString();
      const command={id:"fixture-post-action",clientId:input.clientId,threadId:input.threadId,threadLabel:"Fixture Project",text:input.text,createdAt,progressUpdatedAt:createdAt,status:"queued",progressStage:"queued",dispatchMode:"local-bridge",uiVisibleAt:createdAt};
      commands.push(command);
      messages.push({id:"fixture-post-action-reply",clientId:input.clientId,commandId:command.id,threadId:input.threadId,threadLabel:"Fixture Project",role:"assistant",text:"ACK from post-action fresh snapshot",createdAt});
      return json(res,{command},201);
    }
    if(req.method==="GET" && url.pathname==="/blank"){res.writeHead(200,{"content-type":"text/html"});return res.end("<!doctype html><title>Fixture second tab</title>");}
    if(req.method==="GET" && files.has(url.pathname)){
      const file=files.get(url.pathname);const content=await readFile(resolve(root,"public",file));
      const type=file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":file.endsWith(".json")?"application/json":"text/html";
      res.writeHead(200,{"content-type":type,"cache-control":"no-store"});return res.end(content);
    }
    res.writeHead(404);res.end("No fixture for this route.");
  } catch(error) {
    pageErrors.push("Fixture server: "+error.message);
    if(!res.headersSent)json(res,{error:"Fixture rejected request"},500);else res.destroy();
  }
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin="http://127.0.0.1:"+server.address().port;
let context;
let profile;
async function waitUntil(predicate, timeout=15000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}
  throw new Error("Acceptance condition timed out.");
}
const countDelivery=()=>events.filter(e=>e.kind==="delivery").length;
function releaseHeld() {for(const item of [...held])if(!item.res.destroyed)json(item.res,item.data);held.clear();}
try {
  // Headful Chromium under Xvfb exercises actual tab visibility; no document.hidden override.
  profile=await mkdtemp(resolve(tmpdir(), "codex-links-browser-profile-"));
  await chmod(profile, 0o700);
  context=await chromium.launchPersistentContext(profile,{headless:false,chromiumSandbox:true,args:["--disable-background-networking"],viewport:{width:1100,height:800}});
  await context.route("**/*", route=>{
    if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort("blockedbyclient");}
    return route.continue();
  });
  await context.addInitScript(()=>{
    localStorage.setItem("codex-links-client-id","phone-uuid");
    localStorage.setItem("codex-links-show-all-messages","1");
    localStorage.setItem("codex-links-selected-repo","fixture-project");
    localStorage.setItem("codex-links-dispatch-mode","bridge");
  });
  const page=await context.newPage();
  page.on("pageerror",error=>pageErrors.push(error.message));
  await page.goto(origin+"/?v="+build);
  await page.waitForFunction(()=>document.querySelector("#command-timeline")?.textContent?.includes("Task from telegram:123"));
  async function assertVisibleReply(text) {
    const reply=page.locator(".command-answer").filter({hasText:text});
    assert.equal(await reply.count(),1,"Reply must already exist in the current rendered snapshot.");
    if(!(await reply.evaluate(element=>element.open))) await reply.locator("summary").click();
    await reply.locator(".command-answer-text").waitFor({state:"visible"});
    assert.equal(await reply.locator(".command-answer-text").innerText(),text);
  }
  for(const clientId of clients){
    await page.getByText("Task from "+clientId,{exact:true}).first().waitFor({state:"visible"});
    await assertVisibleReply("Reply for "+clientId);
  }
  checks.push("Initial rendered feed includes phone, desktop and Telegram commands; all three replies were expanded and visible.");

  // Playwright enables focus emulation by default, keeping background pages visible.
  // Disable that automation override so real Chromium tab activation drives visibility.
  // Source: microsoft/playwright v1.62.1, chromium/crPage.ts, setFocusEmulationEnabled.
  const pageSession=await context.newCDPSession(page);
  await pageSession.send("Emulation.setFocusEmulationEnabled",{enabled:false});
  const second=await context.newPage();await second.goto(origin+"/blank");
  const secondSession=await context.newCDPSession(second);
  await secondSession.send("Emulation.setFocusEmulationEnabled",{enabled:false});
  await second.bringToFront();
  await page.waitForFunction(()=>document.hidden===true,null,{polling:50});
  await waitUntil(()=>active===0);
  const hiddenCount=countDelivery();
  await new Promise(resolve=>setTimeout(resolve,4200));
  assert.equal(countDelivery(),hiddenCount);
  checks.push("Actual hidden tab made no new delivery request across an active 3.5-second cadence.");

  mode="hold";await page.bringToFront();
  await page.waitForFunction(()=>document.hidden===false,null,{polling:50});
  await waitUntil(()=>held.size===1);
  const heldCount=countDelivery();
  await second.bringToFront();await page.waitForFunction(()=>document.hidden===true,null,{polling:50});
  await page.bringToFront();await page.waitForFunction(()=>document.hidden===false,null,{polling:50});
  await new Promise(resolve=>setTimeout(resolve,4200));
  assert.equal(countDelivery(),heldCount);
  mode="normal";releaseHeld();await waitUntil(()=>active===0);
  checks.push("Real hide/show and browser scheduling kept one in-flight delivery request.");

  mode="hold";await second.bringToFront();await page.waitForFunction(()=>document.hidden===true,null,{polling:50});
  const beforeTimeout=countDelivery();
  await page.bringToFront();await page.waitForFunction(()=>document.hidden===false,null,{polling:50});
  await waitUntil(()=>countDelivery()>beforeTimeout);
  const abortBefore=aborted;
  await waitUntil(()=>aborted>abortBefore,13000);
  assert.equal(active,0);
  mode="normal";
  commands[0]={...commands[0],text:"Recovered fixture snapshot",progressUpdatedAt:new Date().toISOString()};
  await page.waitForFunction(()=>document.querySelector("#command-timeline")?.textContent?.includes("Recovered fixture snapshot"),null,{timeout:15000});
  checks.push("Native AbortController aborted a hanging network response and scheduled polling recovered.");

  mode="hold";await second.bringToFront();await page.waitForFunction(()=>document.hidden===true,null,{polling:50});
  await page.bringToFront();await page.waitForFunction(()=>document.hidden===false,null,{polling:50});
  await waitUntil(()=>held.size===1);
  const eventStart=events.length;
  await page.locator("#command-thread-select").selectOption("fixture-project");
  await page.locator("#command-input").fill("Acceptance new command");
  await page.locator('#command-form button[type="submit"]').click();
  await waitUntil(()=>submitCount===1);
  // The browser has processed POST success and finished the synchronous handler,
  // including its requireFresh request, before the stale GET is released.
  await page.waitForFunction(()=>document.querySelector("#command-input")?.value==="" && document.querySelector("#command-timeline")?.textContent?.includes("Acceptance new command"),null,{polling:50});
  const beforeRelease=countDelivery();
  mode="normal";releaseHeld();
  await waitUntil(()=>countDelivery()>beforeRelease);
  await page.waitForFunction(()=>document.querySelector("#command-timeline")?.textContent?.includes("ACK from post-action fresh snapshot"));
  const sequence=events.slice(eventStart);
  const submitIndex=sequence.findIndex(e=>e.kind==="submit");
  const nextDelivery=sequence.slice(submitIndex+1).find(e=>e.kind==="delivery");
  assert.ok(nextDelivery && !nextDelivery.activeOnly, "The first trailing request must be a fresh full snapshot, not a later speed poll.");
  await assertVisibleReply("ACK from post-action fresh snapshot");
  markActiveResponse=true;
  await page.getByText("Active-only response applied",{exact:true}).first().waitFor({state:"visible"});
  assert.equal(await page.getByText("Task from desktop-uuid",{exact:true}).first().isVisible(),true,"Completed history must remain visible immediately after the active response, without waiting for a later full poll.");
  await assertVisibleReply("Reply for desktop-uuid");
  checks.push("Real submit queued a fresh full snapshot after the held pre-action response; ACK was visible and completed history survived an active-only poll.");
  assert.equal(maxActive,1);
  assert.deepEqual(pageErrors,[]);
  assert.deepEqual(external,[]);
  await page.screenshot({path:resolve(output,"shared-feed.png"),fullPage:true});
  const report={result:"passed",playwright:playwrightPackage.version,browser:context.browser()?.version() || "Chromium",build,checks,maxConcurrentDelivery:maxActive,abortedRequests:aborted,syntheticCommandSubmissions:submitCount,events,externalRequestsBlocked:external.length,limitations:["Synthetic responses only; no production, Cloudflare preview or account analytics.","Browser acceptance does not prove production KV savings.","Reports and provider integrations are not covered by these browser fixtures."]};
  await writeFile(resolve(output,"report.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report));
} catch(error) {
  await writeFile(resolve(output,"report.json"),JSON.stringify({result:"failed",build,error:error.message,checks,events,pageErrors,external,maxActive},null,2)+"\n");
  throw error;
} finally {
  for(const item of held)item.res.destroy();
  if(context)await context.close();
  if(profile)await rm(profile,{recursive:true,force:true});
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}

