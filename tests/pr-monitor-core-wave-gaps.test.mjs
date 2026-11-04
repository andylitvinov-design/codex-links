import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const source=readFileSync(fileURLToPath(new URL('../telemetry/monitor-ui/pr-cohort-timing.js',import.meta.url)),'utf8');
const window={};
new Function('window','fetch',source)(window,async()=>{throw Error('No HTTP in proof tests')});
const {prove}=window.HHCohortTimeline.testing;
const prefix='https://github.com/andylitvinov-design/books/actions/runs/';
const shaA='a'.repeat(40),shaB='b'.repeat(40),shaC='c'.repeat(40),shaD='d'.repeat(40);
const pr={number:3298,created_at:'2026-11-03T13:03:41Z',merged_at:'2026-11-04T02:50:25Z',
 base:{repo:{full_name:'andylitvinov-design/books'}},head:{sha:shaD,ref:'fix/video-phrases-own-voice-browser-20261103'}};
const row={number:3298,created_at:pr.created_at,merged_at:pr.merged_at};
const commits=[shaA,shaB,shaC,shaD].map(sha=>({sha}));
function run(id,head_sha,created_at,updated_at,conclusion){
 return {id,name:'HH PR core release gate',event:'pull_request',
 head_branch:pr.head.ref,head_repository:{full_name:'andylitvinov-design/books'},
 head_sha,created_at,updated_at,status:'completed',conclusion,html_url:prefix+id};
}
const waves=[
 run(41640986357,shaA,'2026-11-03T13:03:46Z','2026-11-03T13:20:55Z','cancelled'),
 run(41643503505,shaB,'2026-11-03T13:20:43Z','2026-11-03T13:43:53Z','failure'),
 run(41743782907,shaC,'2026-11-04T00:02:24Z','2026-11-04T00:16:47Z','success'),
 run(41762855143,shaD,'2026-11-04T02:45:58Z','2026-11-04T02:49:50Z','success')
];
const history={total_count:4,workflow_runs:[...waves].reverse()};

test('actual overlapping cancelled and failed Core waves produce additive post-red gap',()=>{
 const res=prove(row,pr,commits,history);
 const total=(Date.parse(pr.merged_at)-Date.parse(pr.created_at))/60000;
 const sum=Object.values(res.sums).reduce((x,y)=>x+y,0);
 assert.ok(Math.abs(sum-total)<1e-8);
 assert.equal(res.waves,4);
 assert.equal(res.byStatus.cancelled,1);
 assert.equal(res.byStatus.failed,1);
 assert.equal(res.byStatus.green,2);
 assert.ok(Math.abs(res.sums.after_red-618.5166666666667)<1e-8);
 assert.ok(Math.abs(res.sums.after_green_repeat-149.18333333333334)<1e-8);
 assert.equal(res.longestGap.ref.url,prefix+41643503505);
 assert.ok(res.intervals.every(x=>x.end>=x.start&&x.min>=0));
});

test('earlier real branch SHA survives source rebase without inventing new branch history',()=>{
 const sourceCommits=[shaC,shaD].map(sha=>({sha}));
 const proof=prove(row,pr,sourceCommits,history);
 assert.equal(proof.waves,4);
 assert.equal(proof.historicalHeads,2);
 assert.ok(Math.abs(proof.sums.after_red-618.5166666666667)<1e-8);
});

test('do not attribute time to wrong repo, PR, HEAD, event or truncated GitHub history',()=>{
 assert.throws(()=>prove(row,{...pr,merged_at:'2026-11-04T02:50:26Z'},commits,history),/совпадающая история/);
 assert.throws(()=>prove(row,{...pr,head:{...pr.head,sha:'f'.repeat(40)}},commits,history),/совпадающая история/);
 assert.throws(()=>prove(row,pr,commits,{...history,total_count:100}),/совпадающая история/);
 assert.throws(()=>prove(row,pr,commits,[]),/совпадающая история/);
 const bogus={...history,workflow_runs:history.workflow_runs.map(w=>({...w,head_branch:'unrelated-branch'}))};
 assert.throws(()=>prove(row,pr,commits,bogus),/Нет проверенных Core/);
 const alien={...history,workflow_runs:history.workflow_runs.filter(w=>w.head_sha===shaD).map(w=>({...w,head_sha:shaA,head_repository:{full_name:'unrelated/repo'}})),total_count:1};
 assert.throws(()=>prove(row,pr,commits,alien),/Финальный успешный Core/);
});

test('cohort display uses one denominator and explicitly accounts for unmatched PRs',async()=>{
 const fakeWindow={};
 const meta={...pr};
 let calls=0;
 new Function('window','fetch',source)(fakeWindow,async(url)=>{
  const suffix=url.split('andylitvinov-design/books')[1];
  assert.ok(suffix.startsWith('/'));calls++;
  if(suffix.startsWith('/pulls/3299'))return {ok:false,status:404,json:async()=>({})};
  const data=suffix==='/pulls/3298'?meta:
   suffix.startsWith('/pulls/3298/commits?')?commits:
   suffix.startsWith('/actions/runs?')?history:null;
  assert.ok(data,'Unexpected GitHub URL '+suffix);
  return {ok:true,status:200,json:async()=>data};
 });
 const engine=fakeWindow.HHCohortTimeline;
 const select={begin:Date.parse('2026-11-03T00:00:00Z'),asOf:Date.parse('2026-11-04T03:00:00Z'),
  merged:[{number:3298,created_at:row.created_at,merged_at:row.merged_at},
   {number:3299,created_at:'2026-11-03T15:00:00Z',merged_at:'2026-11-03T16:00:00Z'}]};
 // A second PR has no mock remote response: its read failure must preserve
 // its entire 60-minute interval as unknown, never classify it as zero.
 engine.setCohort(select,()=>{});
 for(let i=0;i<20;i++){
  const v=engine.testing.cohortValue();
  if(v?.covered===1)break;
  await new Promise(resolve=>setTimeout(resolve,1));
 }
 const value=engine.testing.cohortValue();
 assert.ok(value);
 assert.equal(value.n,2);
 assert.equal(value.covered,1);
 const expected=(826.7333333333333+60)/2;
 assert.ok(Math.abs(value.mean-expected)<.01);
 assert.ok(Math.abs(value.rows.reduce((s,x)=>s+x.value,0)-value.mean)<1e-6);
 assert.ok(Math.abs(value.rows.find(x=>x.key==='not_verified').value-30)<1e-6);
 assert.ok(value.additive);
});
