import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const src=readFileSync(fileURLToPath(new URL('../telemetry/monitor-ui/pr-recent-timing.js',import.meta.url)),'utf8');
const marker=' window.HHRecentPR={mount,normalize,analyzeChecks,fromJobs,summary,fullLocal,latestFirst};';
assert.ok(src.includes(marker));
const injected=src.replace(marker,` window.__recentProbe={
 drawRows:(rows,expanded=false)=>{state.status='ready';state.rows=rows;state.at='2026-11-06T13:00:00Z';state.expanded=expanded;
  state.selected=null;target={innerHTML:''};draw();return target.innerHTML;},
 mount:host=>mount(host)
};
${marker}`);
const window={};
const document={createElement:()=>({className:'',innerHTML:'',addEventListener(){}})};
new Function('window','document','fetch',injected)(window,document,()=>Promise.reject(Error('offline')));
const {latestFirst,summary,fullLocal}=window.HHRecentPR;
const row=(number,merged_at,title)=>({number,merged_at,title,total:4,ci:'pending',created_at:'2026-11-06T10:00:00Z'});

test('newest merged_at comes before the longest PR',()=>{
 const sorted=latestFirst([row(101,'2026-11-06T12:00:00Z','fix(ci): old slow'),row(102,'2026-11-06T13:00:00Z','feat(video): new fast')]);
 assert.deepEqual(sorted.map(x=>x.number),[102,101]);
});
test('Toronto merge time includes exact date, hour, minute and second',()=>{
 assert.match(fullLocal(Date.parse('2026-11-06T13:01:09Z')),/06\.11\.2026.*08:01:09/);
});
test('default card is compact, shows recent PR and hides historical detail',()=>{
 const html=window.__recentProbe.drawRows([
  row(102,'2026-11-06T13:00:00Z','fix(video): Latest user request'),
  row(101,'2026-11-06T12:00:00Z','fix(ci): Old slow request')
 ]);
 assert.match(html,/Последний смерженный PR/);
 assert.match(html,/PR #102/);
 assert.match(html,/06\.11\.2026.*08:00:00/);
 assert.match(html,/Видео: Latest user request/);
 assert.match(html,/data-history aria-expanded="false"/);
 assert.doesNotMatch(html,/href="https:\/\/github\.com\/andylitvinov-design\/books\/pull\/101"/);
 const expanded=window.__recentProbe.drawRows([
  row(102,'2026-11-06T13:00:00Z','fix(video): Latest user request'),
  row(101,'2026-11-06T12:00:00Z','fix(ci): Old slow request')
 ],true);
 assert.match(expanded,/href="https:\/\/github\.com\/andylitvinov-design\/books\/pull\/101"/);
});
test('uncertain titles are displayed as escaped plain text, not executable markup',()=>{
 const text=summary('fix(messenger): <img src=x onerror=alert(1)>');
 const html=window.__recentProbe.drawRows([row(102,'2026-11-06T13:00:00Z',text)]);
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/&lt;img/);
});
test('compact panel is inserted immediately after heading, not below KPI history',()=>{
 let at=null;
 const header={insertAdjacentElement:(where,el)=>{at=where;assert.equal(el.className,'ph-recent-live')}};
 const host={querySelector:sel=>sel==='.ph-header'?header:null};
 window.__recentProbe.mount(host);
 assert.equal(at,'afterend');
});
