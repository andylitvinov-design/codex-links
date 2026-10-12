// Full-suite safety preload. CI also removes external interfaces in a disposable
// network namespace; this audited-suite guard is not a general code sandbox.
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import dgram from "node:dgram";
import cp from "node:child_process";
import { promisify } from "node:util";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { basename, delimiter, isAbsolute, resolve } from "node:path";

const guard=fileURLToPath(import.meta.url);
const fixtureRoot=process.env.TMPDIR;
const log=process.env.OFFLINE_GUARD_LOG;
const append=fs.appendFileSync;
const realpath=fs.realpathSync;
if (!fixtureRoot || !isAbsolute(fixtureRoot)) throw new Error("Offline suite requires a fresh absolute TMPDIR.");
if (Object.values(networkInterfaces()).flat().some(address => !address.internal)) {
  throw new Error("Offline suite requires a network namespace without external interfaces.");
}
if (fs.existsSync("/tmp/claude-does-not-exist")) {
  throw new Error("Unexpected executable at the missing-Claude test fixture path.");
}
function blocked(kind){
  if(log)append(log,kind+"\n");
  throw new Error("Offline full-suite guard blocked "+kind+".");
}
function checkPath(value){
  const p=value instanceof URL ? fileURLToPath(value) : String(value);
  if(/(?:^|[\\/])(?:\.dev\.vars(?:\.[^\\/]*)?|\.env(?:\.[^\\/]*)?)$/.test(p) || /[\\/](?:\.aws|\.ssh|\.gnupg)[\\/]|[\\/]Library[\\/]Keychains[\\/]/.test(p))blocked("credential-file read");
}
for(const name of ["readFileSync","readFile","openSync","open","existsSync","createReadStream"]){
  const original=fs[name];fs[name]=function(value,...args){checkPath(value);return original.call(this,value,...args);};
}
for(const name of ["readFile","open","access"]){
  const original=fsp[name];fsp[name]=async function(value,...args){checkPath(value);return original.call(this,value,...args);};
}
function localHost(host){return host==="127.0.0.1" || host==="::1" || host==="[::1]";}
function checkRequest(value){
  const url=new URL(typeof value==="string"||value instanceof URL ? value : value.url);
  if(url.protocol!=="http:" || !localHost(url.hostname))blocked("external network");
}
const fetch=globalThis.fetch;
globalThis.fetch=function(value,...args){checkRequest(value);return fetch.call(this,value,...args);};
globalThis.WebSocket=class{constructor(){blocked("websocket network");}};
function checkConnect(args){
  const first=args[0];
  if(Array.isArray(first))return checkConnect(first);
  const host=typeof first==="object" && first ? first.host||first.hostname : typeof first==="number" ? args[1] : undefined;
  if(!localHost(host))blocked("external socket");
}
for(const name of ["connect","createConnection"]){const original=net[name];net[name]=function(...args){checkConnect(args);return original.apply(this,args);};}
const socketConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){checkConnect(args);return socketConnect.apply(this,args);};
for(const module of [http,https])for(const name of ["request","get"]){
  const original=module[name];module[name]=function(value,...args){
    if(typeof value==="string"||value instanceof URL)checkRequest(value);
    else if(module===https||!localHost(value?.hostname||value?.host))blocked("external HTTP");
    return original.call(this,value,...args);
  };
}
tls.connect=()=>blocked("TLS network");
dgram.createSocket=()=>blocked("datagram network");
const lookup=dns.lookup;
dns.lookup=function(host,...args){if(!localHost(host))blocked("external DNS");return lookup.call(this,host,...args);};
dns.resolve=()=>blocked("external DNS");

// Some synthetic child tests replace env rather than spreading it; enforce the
// same guard anyway. Sensitive OS tools may only resolve to fixture-owned mocks.
const inherited=`--import=${import.meta.url}`;
function childOptions(command,options={}){
  const env={...(options.env||process.env),NODE_OPTIONS:inherited,TMPDIR:fixtureRoot,OFFLINE_GUARD_LOG:log};
  if(["security","launchctl"].includes(basename(String(command)))){
    const first=(env.PATH||"").split(delimiter)[0];
    const candidate=isAbsolute(String(command)) ? String(command) : resolve(first,String(command));
    let executable;
    try { executable=realpath(candidate); } catch { blocked("missing synthetic credential or service tool"); }
    if(!executable.startsWith(realpath(fixtureRoot)+"/"))blocked("real credential or service tool");
  }
  return {...options,env};
}
for(const name of ["spawn","spawnSync"]){
  const original=cp[name];cp[name]=function(command,args,options){
    if(!Array.isArray(args)){options=args;args=[];}
    return original.call(this,command,args,childOptions(command,options));
  };
}
for(const name of ["execFile","execFileSync"]){
  const original=cp[name];cp[name]=function(command,args,options,callback){
    if(!Array.isArray(args)){callback=options;options=args;args=[];}
    if(typeof options==="function"){callback=options;options={};}
    return original.call(this,command,args,childOptions(command,options),callback);
  };
}
for(const name of ["exec","execSync"]){
  const original=cp[name];cp[name]=function(command,options,callback){
    if(typeof options==="function"){callback=options;options={};}
    if(/\b(?:security|launchctl)\b/.test(command))blocked("shell credential or service tool");
    return original.call(this,command,childOptions(command,options),callback);
  };
}
// Preserve Node's multi-value promisified exec result while using our wrapper.
for(const name of ["execFile","exec"]){
  Object.defineProperty(cp[name],promisify.custom,{value:(...args)=>{
    let child;
    const promise=new Promise((resolve,reject)=>{
      child=cp[name](...args,(error,stdout,stderr)=>{
        if(error){error.stdout=stdout;error.stderr=stderr;reject(error);}
        else resolve({stdout,stderr});
      });
    });
    promise.child=child;
    return promise;
  }});
}
syncBuiltinESMExports();
