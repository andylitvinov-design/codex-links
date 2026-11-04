import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const file=relative=>readFileSync(fileURLToPath(new URL('../telemetry/monitor-ui/'+relative,import.meta.url)),'utf8');
const window={};
new Function('window',file('pr-precommit-slices.js'))(window);
new Function('window',file('pr-three-cohorts.js'))(window);
const {analyze}=window.HHPrecommit;
const {summarize,check,rolling}=window.HHCohortCompare;
const snap=JSON.parse(file('pr-three-cohorts-snapshot.json'));
const byId=id=>snap.windows.find(w=>w.id===id);
const shaA='abcdef0123456789abcdef0123456789abcdef01',shaB='fedcba9876543210fedcba9876543210fedcba98';
const iso=(hh,mm,ss=0)=>'2026-11-03T'+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0')+'Z';
const pr={number:123,created_at:iso(0,0),merged_at:iso(0,50),head:{sha:shaA,ref:'test/head-123'}};
const commits=[{sha:shaB,commit:{committer:{date:iso(0,1)},message:'source init'}},
 {sha:shaA,commit:{committer:{date:iso(0,40)},message:'final fix'}}];
const coreRuns=[
 {id:101,name:'HH PR core release gate',event:'pull_request',head_branch:pr.head.ref,head_sha:shaB,
  created_at:iso(0,1),conclusion:'failure',html_url:'https://github.com/andylitvinov-design/books/actions/runs/101'},
 {id:102,name:'HH PR core release gate',event:'pull_request',head_branch:pr.head.ref,head_sha:shaA,
  created_at:iso(0,30),conclusion:'success',html_url:'https://github.com/andylitvinov-design/books/actions/runs/102'}
];
const job=(created,started,done)=>({name:'core-lint-types-build',status:'completed',conclusion:'success',
 created_at:created,started_at:started,completed_at:done});
const jobs={'101':[job(iso(0,1,5),iso(0,1,10),iso(0,2,10))],
 '102':[job(iso(0,30,10),iso(0,30,20),iso(0,35,20))]};
const runs={total_count:2,workflow_runs:coreRuns};

test('three historical created-at cohorts are exhaustive and reproducible',()=>{
 assert.equal(snap.schema,'HH_PR_THREE_CREATED_COHORTS_V1');
 assert.equal(snap.windows.length,3);
 for(const w of snap.windows)assert.equal(check(w),true);
 assert.deepEqual(['two_weeks_ago','week_ago','last_day'].map(id=>summarize(byId(id)).n),[151,130,86]);
 assert.deepEqual(['two_weeks_ago','week_ago','last_day'].map(id=>summarize(byId(id)).open),[9,53,6]);
 assert.deepEqual(['two_weeks_ago','week_ago','last_day'].map(id=>summarize(byId(id)).merged),[137,70,63]);
 assert.deepEqual(['two_weeks_ago','week_ago','last_day'].map(id=>summarize(byId(id)).unmerged),[5,7,17]);
});
test('DST-adjusted Toronto cohorts keep the same local time after a week or two',()=>{
 const w=rolling(new Date('2026-11-04T13:05:00Z'));
 assert.deepEqual(w.map(x=>x.to),['2026-11-04T13:05:00.000Z','2026-10-28T12:05:00.000Z','2026-10-21T12:05:00.000Z']);
 assert.deepEqual(w.map(x=>x.from),['2026-11-03T13:05:00.000Z','2026-10-27T12:05:00.000Z','2026-10-20T12:05:00.000Z']);
});
test('pre-final chronology shows exact separate queue, execution and post-failure gap',()=>{
 const a=analyze({pr,commits,workflowRuns:runs,jobsByRun:jobs});
 assert.equal(a.untilLastCommitSeconds,2400);
 assert.equal(a.totalsSeconds.before_first,60);
 assert.equal(a.totalsSeconds.routing,15);
 assert.equal(a.totalsSeconds.queue,15);
 assert.equal(a.totalsSeconds.execution,360);
 assert.equal(a.totalsSeconds.after_failure,1670);
 assert.equal(a.totalsSeconds.after_success,280);
 assert.equal(Object.values(a.totalsSeconds).reduce((x,y)=>x+y,0),2400);
 assert.equal(a.proofCoverage.withJobs,2);
 assert.equal(a.historyPartial,false);
});
test('missing CI job evidence never produces fictitious execution or runner queue',()=>{
 const a=analyze({pr,commits,workflowRuns:runs,jobsByRun:{}});
 assert.equal(a.totalsSeconds.queue,0);
 assert.equal(a.totalsSeconds.execution,0);
 assert.ok(a.totalsSeconds.incomplete_ci>2000);
 assert.equal(Object.values(a.totalsSeconds).reduce((x,y)=>x+y,0),2400);
});
test('outdated HEAD, absent commits and bad cohorts fail closed',()=>{
 assert.throws(()=>analyze({pr:{...pr,head:{...pr.head,sha:'0'.repeat(40)}},commits,workflowRuns:runs}),/HEAD/);
 assert.throws(()=>analyze({pr,commits:[],workflowRuns:runs}),/коммитов/);
 assert.equal(check({...byId('week_ago'),expected_count:129}),false);
 assert.equal(check({...byId('week_ago'),complete:false}),false);
});
