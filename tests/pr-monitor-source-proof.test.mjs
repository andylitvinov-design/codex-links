import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const code=readFileSync(fileURLToPath(new URL('../telemetry/monitor-ui/pr-stage-dashboard.js',import.meta.url)),'utf8');
const point=" if(document.readyState==='loading')";
assert.ok(code.includes(point));
const injected=code.replace(point,` window.__test={
 set:(data,audit,windowHours)=>{ledger=data;cohortData=null;headAudit=audit;hours=windowHours;scope='all'},
 analysis,auditParts,compositionCard
};\n ${point}`);
const host={},document={readyState:'loading',addEventListener(){}},window={};
new Function('window','document','fetch','atob','TextDecoder',injected)(window,document,()=>Promise.reject(Error('offline')),()=>{},TextDecoder);
const sha='abcdef0123456789abcdef0123456789abcdef01';
const at=(minute)=>new Date(Date.UTC(2026,10,3,0,minute)).toISOString();
const prs=[
 {number:100,created_at:at(0),merged_at:at(30),head_sha:sha,state:'closed',base:'codex/public-book-library'},
 {number:101,created_at:at(0),merged_at:at(60),head_sha:'0'.repeat(40),state:'closed',base:'codex/public-book-library'}
];
const ledger={generated_at:at(90),window:{to:at(90)},prs};
const audit={schema:'HH_PR_HEAD_LIFECYCLE_AUDIT_V1',repo:'andylitvinov-design/books',
 recorded_at:at(80),records:[{
 pr:100,created_at:at(0),merged_at:at(30),head_sha:sha,head_commit_at:at(10),
 commit_url:'https://github.com/andylitvinov-design/books/commit/'+sha,
 last_head_first_successful_job_at:at(11),
 runner_job_url:'https://github.com/andylitvinov-design/books/actions/runs/123/job/456',
 last_head_merge_gate_green_at:at(25),
 merge_gate_job_url:'https://github.com/andylitvinov-design/books/actions/runs/123/job/789'
 }]};

test('evidence audit is a disjoint exact-duration partition; unknown stays unknown',()=>{
 window.__test.set(ledger,audit,24);
 const a=window.__test.analysis(),p=window.__test.auditParts(a);
 assert.equal(a.total.mean,45);
 assert.equal(p.audited.length,1);
 assert.deepEqual(p.counts,[1,1,1,1,0,1]);
 assert.deepEqual(p.means,[5,.5,7,2.5,0,30]);
 assert.equal(p.sum,a.total.mean);
 const html=window.__test.compositionCard(a);
 assert.match(html,/102|Последний коммит/);
 assert.match(html,/Когда: самые долгие проверенные PR/);
 assert.match(html,/Итого Created → Merged/);
 assert.match(html,/45,00/);
 assert.match(html,/2026/);
});
test('historical proof from a different HEAD cannot classify a PR',()=>{
 window.__test.set(ledger,{...audit,records:[{...audit.records[0],head_sha:'1'.repeat(40)}]},24);
 const a=window.__test.analysis(),p=window.__test.auditParts(a);
 assert.deepEqual(p.means,[0,0,0,0,0,45]);
 assert.equal(p.audited.length,0);
 assert.equal(p.counts[5],2);
});
test('unobserved stage is not treated as zero time after a verified final commit',()=>{
 const withoutRunner={...audit,records:[{...audit.records[0],
  last_head_first_successful_job_at:null,last_head_merge_gate_green_at:null}]};
 window.__test.set(ledger,withoutRunner,24);
 const a=window.__test.analysis(),p=window.__test.auditParts(a);
 assert.deepEqual(p.means,[5,0,0,0,10,30]);
 assert.equal(p.counts[4],1);
 assert.equal(p.sum,45);
});
