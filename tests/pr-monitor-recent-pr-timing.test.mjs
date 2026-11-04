import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const src=readFileSync(fileURLToPath(new URL('../telemetry/monitor-ui/pr-recent-timing.js',import.meta.url)),'utf8');
const window={};
new Function('window',src)(window);
const {normalize,analyzeChecks,fromJobs}=window.HHRecentPR;
const sha='eebb003d5b4f7e82880da5dceaad205b7b04d7e2';
const jobRoot='https://github.com/andylitvinov-design/books/actions/runs/41779762460/job/';
const pr={number:3378,title:'MyTube dark UI',created_at:'2026-11-04T05:31:22Z',
 merged_at:'2026-11-04T05:42:38Z',head:{sha},base:{ref:'codex/public-book-library',
 repo:{full_name:'andylitvinov-design/books'}}};
const run={id:41779762460,name:'HH PR core release gate',head_sha:sha,
 created_at:'2026-11-04T05:31:26Z',html_url:'https://github.com/andylitvinov-design/books/actions/runs/41779762460'};
const times=(created,started,completed)=>({created_at:'2026-11-04T'+created+'Z',started_at:'2026-11-04T'+started+'Z',completed_at:'2026-11-04T'+completed+'Z'});
const jobs={total_count:3,jobs:[
 {id:1,name:'core-lint-types-build',status:'completed',conclusion:'success',...times('05:31:26','05:31:29','05:35:57')},
 {id:2,name:'hh-specialist',status:'completed',conclusion:'success',...times('05:31:26','05:31:30','05:42:05')},
 {id:3,name:'hh-merge-check',status:'completed',conclusion:'success',...times('05:42:05','05:42:23','05:42:27')}
]};
const checks={total_count:3,check_runs:jobs.jobs.map(j=>({
 id:j.id,name:j.name,head_sha:sha,status:'completed',conclusion:'success',
 started_at:j.started_at,completed_at:j.completed_at,html_url:jobRoot+j.id
}))};
const commits=[{sha,commit:{committer:{date:'2026-11-04T05:31:18Z'},message:'feat(mytube): dark video UI'}}];

test('recent PR normalizes only exact production-target merged PRs',()=>{
 const row=normalize(pr);
 assert.equal(row.total*60,676);
 assert.equal(normalize({...pr,base:{ref:'codex/bootstrap-books',repo:{full_name:'andylitvinov-design/books'}}}),null);
 assert.equal(normalize({...pr,head:{sha:'BAD'}}),null);
 assert.equal(normalize({...pr,merged_at:null}),null);
});

test('the exact-head final CI critical path is additive and separates runner queue',()=>{
 const row=analyzeChecks(normalize(pr),checks);
 assert.equal(row.ci,'verified');
 assert.equal(row.critical.name,'hh-specialist');
 assert.equal(row.critical.min*60,635);
 const detail=fromJobs(row,run,jobs,commits);
 assert.deepEqual(detail.phases.map(p=>(p.end-p.begin)/1000),[4,0,3,658,11]);
 assert.equal(detail.phases.reduce((s,p)=>s+(p.end-p.begin)/1000,0),676);
 const specialist=detail.jobs.find(x=>x.name==='hh-specialist');
 assert.equal(Math.round(specialist.runtime*60),635);
 assert.equal(Math.round(specialist.queue*60),4);
 assert.equal(detail.commits.length,1);
});

test('no merge attribution from stale HEAD / failing gates / inaccessible jobs',()=>{
 assert.equal(analyzeChecks(normalize(pr),{total_count:3,check_runs:checks.check_runs.map(x=>({...x,head_sha:'f'.repeat(40)}))}).ci,'partial');
 assert.equal(analyzeChecks(normalize(pr),{total_count:3,check_runs:checks.check_runs.map(x=>x.name==='hh-merge-check'?{...x,conclusion:'failure'}:x)}).ci,'partial');
 const row=analyzeChecks(normalize(pr),checks);
 assert.throws(()=>fromJobs(row,{...run,head_sha:'f'.repeat(40)},jobs,commits),/чужая история HEAD/);
 assert.throws(()=>fromJobs(row,run,{...jobs,total_count:101},commits),/чужая история HEAD/);
 assert.throws(()=>fromJobs(row,run,{...jobs,jobs:jobs.jobs.map(x=>x.name==='hh-merge-check'?{...x,completed_at:'2026-11-04T05:42:50Z'}:x)},commits),/Core CI/);
});
