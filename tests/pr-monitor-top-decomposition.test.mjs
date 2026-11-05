import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const modulePath=fileURLToPath(new URL('../telemetry/monitor-ui/pr-stage-dashboard.js',import.meta.url));
const source=readFileSync(modulePath,'utf8');
const marker=" if(document.readyState==='loading')";
assert.ok(source.includes(marker),'browser entrypoint must exist');
const injected=source.replace(marker,
 ` window.__probe={set:(data,h)=>{ledger=data;cohortData=null;hours=h;scope='all';error=null},
  analysis,compositionCard,phaseHTML,render,mount,setHost:v=>{host=v},
  chooseEvidence,validCohort,validLedger,validAudit};
 ${marker}`);

const pr=(number,mergedAt,stamps={})=>({
 number,created_at:'2026-11-03T00:00:00Z',merged_at:mergedAt,
 state:'closed',base:'codex/public-book-library',stamps
});
const stamp=at=>({at,verified:true,source:'actions',actor:'github-actions[bot]'});
const ledger={
 generated_at:'2026-11-03T02:00:00Z',
 window:{to:'2026-11-03T02:00:00Z'},
 prs:[
  pr(100,'2026-11-03T00:30:00Z',{
   CI_queued:stamp('2026-11-03T00:10:00Z'),
   runner_started:stamp('2026-11-03T00:12:00Z'),
   CI_green:stamp('2026-11-03T00:25:00Z'),
   LIVE_verified:stamp('2026-11-03T00:47:00Z')
  }),
  pr(101,'2026-11-03T01:00:00Z')
 ]
};
function harness(){
 const host={innerHTML:'',classList:{add(){}},addEventListener(){},id:null};
 const header={nextElementSibling:null,contains:()=>false,insertAdjacentElement:(pos,node)=>{
  assert.equal(pos,'afterend');assert.equal(node,host);
  header.nextElementSibling=node;header.moved=true;
 }};
 const main={querySelector:sel=>sel==='header.header'?header:null,contains:x=>x===host};
 host.closest=()=>main;
 const document={readyState:'loading',addEventListener(){},getElementById:()=>host,querySelector:()=>null,
  createElement:tag=>({tagName:tag,rel:null,href:null,defer:false,src:null,onload:null}),
  head:{appendChild(){}}
 };
 const window={};
 const fetch=async url=>({
  ok:true,
  json:async()=>String(url).includes('pr-created-cohort')?{rows:ledger.prs,generated_at:ledger.generated_at}:ledger
 });
 new Function('window','document','fetch',injected)(window,document,fetch);
 window.__probe.set(ledger,24);
 window.__probe.setHost(host);
 return {probe:window.__probe,host,header};
}

test('created→merged average is exact; four nonoverlapping contributions plus unknown add up',()=>{
 const {probe}=harness(),a=probe.analysis();
 assert.equal(a.total.n,2);
 assert.equal(a.total.mean,45);
 assert.deepEqual(a.groups.map(g=>g.statistics.n),[1,1,1,1,1]);
 assert.deepEqual(a.groups.slice(0,4).map(g=>g.statistics.mean),[10,2,13,5]);
 assert.deepEqual(a.groups.slice(0,4).map(g=>g.contribution),[5,1,6.5,2.5]);
 assert.equal(a.knownAverage,15);
 assert.equal(a.unknownAverage,30);
 assert.equal(a.groups[4].contribution,0,'post-merge LIVE is not added to Created→Merged');
 assert.equal(a.invalidSpans,0);
});
test('table is near the top, before expanded diagnostics; direct first-stage average is prominent',()=>{
 const {probe,host,header}=harness();
 probe.render();
 const html=host.innerHTML;
 assert.ok(html.indexOf('Среднее время одного PR от создания до merge')>=0);
 assert.ok(html.indexOf('Разложение среднего до merge')>html.indexOf('Среднее время одного PR от создания до merge'));
 assert.ok(html.indexOf('Технические этапы CI')>html.indexOf('Разложение среднего до merge'));
 assert.match(html,/Нет подтверждённых событий перехода/);
 assert.match(html,/30,00/);
 assert.match(html,/45,00/);
 assert.match(html,/Создан → Очередь CI/);
 assert.match(html,/Необязательные действия: Ready \/ Triage \/ Repair/);
 assert.doesNotMatch(html,/data-phase="pre_ci" open/);
 probe.mount();
 assert.equal(header.nextElementSibling,host,'block moved immediately below page header');
});
test('empty created cohort never invents zero-minute phase durations',()=>{
 const {probe}=harness();
 probe.set({...ledger,prs:[]},1);
 const a=probe.analysis(),html=probe.compositionCard(a);
 assert.equal(a.total.n,0);
 assert.equal(a.total.mean,null);
 assert.match(html,/пока нет PR/);
 assert.doesNotMatch(html,/0,00 мин\/PR/);
});

test('old 05:17 archive and 05:43 audit are excluded from current 23:45 cohort',()=>{
 const {probe}=harness(),now=Date.parse('2026-11-04T23:45:00Z');
 const cohort={schema:'HH_PR_CREATED_COHORT_V1',repo:'andylitvinov-design/books',generated_at:'2026-11-04T23:44:00Z',rows:ledger.prs};
 const old={schema:'HH_PR_TRANSITION_LEDGER_V1',repo:'andylitvinov-design/books',
  generated_at:'2026-11-04T05:17:28.125Z',
  window:{from:'2026-11-02T04:13:51.633Z',to:'2026-11-04T04:13:51.633Z',complete:false},
  coverage:{cohort:{stage_events_complete:false}},prs:ledger.prs};
 const audit={schema:'HH_PR_HEAD_LIFECYCLE_AUDIT_V1',repo:'andylitvinov-design/books',
  recorded_at:'2026-11-04T05:43:06.935Z',
  scope:{window_from:'2026-11-03T04:13:51.633Z',window_to:'2026-11-04T04:13:51.633Z'},records:[]};
 const selected=probe.chooseEvidence(cohort,old,audit,now);
 assert.equal(selected.cohort,cohort);
 assert.equal(selected.ledger,null);
 assert.equal(selected.audit,null);
 assert.equal(selected.messages.length,2);
});
test('recent partial evidence is retained only as an explicitly partial sample',()=>{
 const {probe}=harness(),now=Date.parse('2026-11-04T23:45:00Z');
 const cohort={schema:'HH_PR_CREATED_COHORT_V1',repo:'andylitvinov-design/books',generated_at:'2026-11-04T23:44:00Z',rows:ledger.prs};
 const recent={schema:'HH_PR_TRANSITION_LEDGER_V1',repo:'andylitvinov-design/books',
  generated_at:'2026-11-04T23:44:00Z',
  window:{from:'2026-11-02T23:40:00Z',to:'2026-11-04T23:40:00Z',complete:false},
  coverage:{cohort:{stage_events_complete:false}},prs:ledger.prs};
 const selected=probe.chooseEvidence(cohort,recent,null,now);
 assert.equal(selected.ledger,recent);
 assert.match(selected.messages.join(' '),/часть этапов/);
 assert.equal(probe.validLedger({...recent,window:{...recent.window,to:'2026-11-05T04:00:00Z'}},now),false);
});
test('stale created cohort never substitutes stale ledger as current statistics',()=>{
 const {probe}=harness(),now=Date.parse('2026-11-04T23:45:00Z');
 const old={schema:'HH_PR_CREATED_COHORT_V1',repo:'andylitvinov-design/books',
  generated_at:'2026-11-04T05:17:00Z',rows:ledger.prs};
 const selected=probe.chooseEvidence(old,ledger,null,now);
 assert.equal(selected.cohort,null);
 assert.equal(selected.ledger,null);
 assert.equal(probe.validCohort(old,now),false);
});
