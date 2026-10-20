import test from "node:test";
import assert from "node:assert/strict";
import { createFixture, fixtureDelivery } from "./helpers/delivery-browser.mjs";
import { readActiveCommands } from "../functions/_lib/commands.js";
import { onRequest as middleware } from "../functions/api/_middleware.js";

test("cheap poll keeps recent cross-device and Telegram conversations, without reports", async () => {
  const fixture = createFixture();
  const response = await fixtureDelivery(fixture, "scope=public&mode=poll");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.commands.map(c => c.clientId).sort(), ["desktop-uuid","phone-uuid","telegram:123"]);
  assert.deepEqual(payload.messages.map(m => m.clientId).sort(), ["desktop-uuid","phone-uuid","telegram:123"]);
  assert.deepEqual(payload.reports, []);
  assert.equal(fixture.reads.length, 11);
  assert.equal(fixture.writes.length, 0);
});

test("large histories have bounded poll reads, remain unmodified and fully retrievable", async () => {
  const fixture = createFixture();
  const now = new Date().toISOString();
  const commands = Array.from({length:120}, (_,n)=>"b-cmd-"+n);
  const messages = Array.from({length:180}, (_,n)=>"b-msg-"+n);
  fixture.map.set("commands:recent:v2", commands);
  fixture.map.set("commands:active:v2", []);
  fixture.map.set("inbox:messages:recent:v2", messages);
  for(let n=0;n<commands.length;n++) fixture.map.set("command:item:v2:"+commands[n], {
    id:commands[n],clientId:"phone-uuid",threadId:"project",threadLabel:"Project",
    text:"Test "+n,createdAt:now,status:"answered",dispatchMode:"local-bridge"
  });
  for(let n=0;n<messages.length;n++) fixture.map.set("inbox:message:item:v2:"+messages[n], {
    id:messages[n], clientId:"phone-uuid",threadId:"project",threadLabel:"Project",
    commandId:commands[n%commands.length],text:"Message "+n,role:"assistant",createdAt:now
  });
  const response = await fixtureDelivery(fixture,"scope=public&mode=poll");
  const payload = await response.json();
  assert.equal(response.status,200);
  assert.equal(payload.commands.length,8);
  assert.equal(payload.messages.length,12);
  assert.ok(fixture.reads.length<=25, "unexpected KV fanout: "+fixture.reads.length);
  assert.equal(fixture.writes.length,0);
  assert.equal(fixture.map.get("commands:recent:v2").length,120);
  assert.equal(fixture.map.get("inbox:messages:recent:v2").length,180);
});

test("empty current active index is cheap and KV errors never cause fallback scans", async () => {
  const fixture = createFixture();
  fixture.map.set("commands:active:v2", []);
  const empty = await readActiveCommands(fixture.env);
  assert.deepEqual(empty,[]);
  assert.equal(fixture.reads.length,2);
  const bad = {LINKS_STORE:{async get(){throw new Error("KV read limit exceeded");}}};
  await assert.rejects(readActiveCommands(bad),/KV read limit exceeded/);
});

test("middleware poll response preserves client data and respects quota failure gate", async () => {
  const fixture=createFixture();
  const response=await middleware({
    request:new Request("https://budgeted.example/api/delivery?scope=public&mode=poll"),
    env:fixture.env,
    next(){throw new Error("unexpected")}
  });
  assert.equal(response.status,200);
  assert.equal((await response.json()).messages.length,3);
  assert.equal(fixture.writes.length,0);
  assert.ok(fixture.reads.length<=11);
});
