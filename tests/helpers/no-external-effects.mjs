// CI fixture tests must never contact production, Slack, or other providers.
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

function blocked() { throw new Error("External network access is disabled for offline validation."); }
globalThis.fetch = blocked;
globalThis.WebSocket = class { constructor() { blocked(); } };
net.connect = blocked;
net.createConnection = blocked;
net.Socket.prototype.connect = blocked;
tls.connect = blocked;
http.request = blocked;
http.get = blocked;
https.request = blocked;
https.get = blocked;
dgram.createSocket = blocked;
dns.lookup = blocked;
dns.resolve = blocked;

const originalExists = fs.existsSync;
const originalReadFile = fs.readFileSync;
function checkPath(value) {
  if (String(value).replaceAll("\\", "/").endsWith("/.dev.vars") || String(value) === ".dev.vars") {
    throw new Error("Offline validation must not read .dev.vars.");
  }
}
fs.existsSync = function (value) { checkPath(value); return originalExists.call(this, value); };
fs.readFileSync = function (value, ...args) { checkPath(value); return originalReadFile.call(this, value, ...args); };
syncBuiltinESMExports();

