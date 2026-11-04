'use strict';
/* HH_PR_PIPELINE_FIVE_PHASES_V3
 * Real created-cohort average, additive verified timeline contributions,
 * unknown gaps kept separate. No invented timestamps or CI runs.
 */
(()=>{
 const HOUR_OPTIONS=[1,6,12,24,48];
 const STEPS=[
  ['created','ready','Создан → Готов','Подготовка PR, выход из Draft и подтверждённое Ready.','Автор PR','GitHub ready_for_review / инструментальная метка'],
  ['ready','triage','Готов → Triage','Первичная оценка и маршрутизация исключений.','Triage Router','GitHub label / журнал маршрутизатора'],
  ['triage','claimed','Triage → Взят','Подтверждённый захват задачи исполнителем.','Worker dispatcher','Worker lease / GitHub assignment'],
  ['claimed','repair_started','Взят → Repair','Фактическое начало исправления PR.','Repair Worker','Инструментальное событие начала Repair'],
  ['repair_started','source_published','Repair → Код опубликован','Фактический push и публикация исправленного исходного кода.','Source publisher','Инструментальная публикация HEAD SHA'],
  ['source_published','CI_queued','Код → Очередь CI','GitHub зарегистрировал запуск проверок на HEAD.','GitHub Actions','Workflow run created_at'],
  ['CI_queued','runner_started','Очередь → Runner','От постановки CI в очередь до старта runner.','GitHub runners','Workflow job started_at'],
  ['runner_started','CI_green','Runner → CI зелёный','Время до успешного завершения требуемых проверок.','Core / Specialist','Required check runs: success'],
  ['CI_green','merged','CI зелёный → Merged','От успешного CI до фактического GitHub merge.','Merge Gate / auto-merge','GitHub pull_request.merged_at'],
  ['merged','LIVE_verified','Merged → LIVE','От merge до подтверждённой production-версии.','Deployment verifier','Vercel READY + проверка production SHA']
 ];
 // Triage and Repair are optional exceptions, not required for every PR.
 // These five non-overlapping boundaries are measurable on the fast path.
 const GROUPS=[
  {id:'pre_ci',title:'Подготовка и запуск CI',desc:'Created → CI queued',start:0,end:6,steps:[0,1,2,3,4,5]},
  {id:'ci_queue',title:'Очередь CI',desc:'CI queued → Runner started',start:6,end:7,steps:[6]},
  {id:'ci_checks',title:'Проверки CI',desc:'Runner started → CI green',start:7,end:8,steps:[7]},
  {id:'merge',title:'Слияние PR',desc:'CI green → Merged',start:8,end:9,steps:[8]},
  {id:'live',title:'Публикация LIVE',desc:'Merged → LIVE verified',start:9,end:10,steps:[9]}
 ];
 const IDS=['created','ready','triage','claimed','repair_started','source_published','CI_queued','runner_started','CI_green','merged','LIVE_verified'];
 const e=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':'&#39;');
 const ts=v=>{const n=Date.parse(v||'');return Number.isFinite(n)?n:null};
 const fmt=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:1}):'—';
 const moneyMin=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
 const delta=(a,b)=>a!==null&&b!==null&&b>=a?(b-a)/60000:null;
 const human=v=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'America/Toronto',year:'numeric',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
 const link=p=>'<a href="https://github.com/andylitvinov-design/books/pull/'+Number(p.number)+'" target="_blank" rel="noopener noreferrer">#'+Number(p.number)+'</a>';
 const number=v=>Number.isFinite(v)?v:0;
 const PRODUCTION='codex/public-book-library';
 let host=null,ledger=null,cohortData=null,hours=24,scope='all',openGroups=new Set(),error=null,headAudit=null,auditError=null;
 function aggregate(nums){
  const v=nums.filter(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0).sort((a,b)=>a-b),n=v.length;
  return {n,mean:n?v.reduce((a,b)=>a+b,0)/n:null,
   median:n?(n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2):null,
   p90:n?v[Math.ceil(n*.9)-1]:null};
 }
 function nativeRows(){
  const raw=cohortData&&Array.isArray(cohortData.rows)?cohortData.rows:ledger&&Array.isArray(ledger.prs)?ledger.prs:[];
  const asOf=ts(cohortData&&cohortData.generated_at)||ts(ledger&&ledger.window&&ledger.window.to)||ts(ledger&&ledger.generated_at)||Date.now();
  const begin=asOf-hours*3600000;
  const filtered=raw.filter(p=>{
   const t=ts(p.created_at);
   return t!==null&&t>=begin&&t<=asOf&&(scope==='all'||p.base===PRODUCTION);
  });
  const merged=filtered.filter(p=>{const start=ts(p.created_at),end=ts(p.merged_at);return start!==null&&end!==null&&end>=start&&end<=asOf});
  const pending=filtered.filter(p=>!p.merged_at&&p.state!=='closed');
  const closed=filtered.filter(p=>!p.merged_at&&p.state==='closed');
  return {all:filtered,merged,pending,closed,asOf,begin,source:cohortData?'native GitHub cohort':'fallback ledger'};
 }
 const byPr=()=>new Map((ledger&&ledger.prs||[]).map(p=>[Number(p.number),p]));
 function eventAt(pr,key,record){
  if(key==='created')return ts(pr.created_at);
  if(key==='merged')return ts(pr.merged_at);
  const ev=record&&record.stamps&&record.stamps[key];
  if(!ev||ev.verified!==true)return null;
  const n=ts(ev.at),start=ts(pr.created_at),end=ts(pr.merged_at);
  if(n===null||start===null||n<start)return null;
  if(key==='LIVE_verified')return end!==null&&n>=end?n:null;
  return end!==null&&n>end?null:n;
 }
 function analysis(){
  const select=nativeRows(),refs=byPr(),ended=select.merged,allMerged=ended.length;
  const durations=[],liveValues=[],verifiedSteps=STEPS.map(()=>[]),groupValues=GROUPS.map(()=>[]);
  const contrib=GROUPS.map(()=>0),touched=new Set(),details=[];
  let unknownSum=0,verifiedSum=0,invalidSpans=0;
  for(const p of ended){
   const rec=refs.get(Number(p.number));
   const total=delta(ts(p.created_at),ts(p.merged_at));
   if(total===null)continue;
   durations.push(total);
   const times=IDS.map(k=>eventAt(p,k,rec));
   const live=delta(times[0],times[10]);if(live!==null)liveValues.push(live);
   // Child receipts are shown for diagnosis; never sum them with their parent.
   const attribution=GROUPS.map(()=>0);
   for(let i=0;i<STEPS.length;i++){
    const duration=delta(times[i],times[i+1]);
    if(duration===null)continue;
    verifiedSteps[i].push({p,minutes:duration,stamp:rec&&rec.stamps&&rec.stamps[STEPS[i][1]]});
    touched.add(p.number);
   }
   let known=0;
   GROUPS.forEach((g,i)=>{
    const duration=delta(times[g.start],times[g.end]);
    if(duration===null)return;
    groupValues[i].push({p,minutes:duration});
    // Delivery occurs after merge, not in Created → Merged accounting.
    if(g.end<=9){
     attribution[i]=duration;
     contrib[i]+=duration;
     known+=duration;
    }
   });
   if(known>total+0.05)invalidSpans++;
   known=Math.min(total,known);
   verifiedSum+=known;
   unknownSum+=Math.max(0,total-known);
   details.push({p,total,known,unknown:Math.max(0,total-known),attribution});
  }
  const total=aggregate(durations),live=aggregate(liveValues);
  const substeps=STEPS.map((step,i)=>{
   const rows=verifiedSteps[i].slice().sort((a,b)=>b.minutes-a.minutes);
   return {step,index:i,rows,statistics:aggregate(rows.map(x=>x.minutes))};
  });
  const groups=GROUPS.map((group,i)=>{
   const rows=groupValues[i].slice().sort((a,b)=>b.minutes-a.minutes);
   return {...group,index:i,rows,statistics:aggregate(rows.map(x=>x.minutes)),substeps:group.steps.map(k=>substeps[k]),
     contribution:allMerged?contrib[i]/allMerged:null,
     observedPRs:new Set([...rows.map(r=>r.p.number),
      ...group.steps.flatMap(k=>verifiedSteps[k].map(r=>r.p.number))]).size};
  });
  const knownAverage=allMerged?verifiedSum/allMerged:null,unknownAverage=allMerged?unknownSum/allMerged:null;
  return {select,total,live,groups,substeps,details,knownAverage,unknownAverage,invalidSpans,seen:touched.size};
 }
 function statTitle(stat){
  return fmt(stat.mean)+' <small>мин</small>';
 }
 function detailSamples(rows,limit){
  if(!rows.length)return '<p class="ph-note">Нет PR с двумя подтверждёнными отметками для данного перехода.</p>';
  return '<div class="ph-samples">'+rows.slice(0,limit).map(r=>
   '<div class="ph-sample">'+link(r.p)+'<strong>'+fmt(r.minutes)+' мин</strong><span>'+e(r.stamp&&r.stamp.actor||'Исполнитель не установлен')+'</span></div>'
  ).join('')+'</div>';
 }
 function substepHTML(row,denom){
  const s=row.statistics,step=row.step,source=step[5];
  return '<details class="ph-substep"><summary>'+
   '<span class="ph-subheading">'+e(step[2])+'</span>'+
   '<span class="ph-time">'+(s.n?statTitle(s):'нет замера')+'</span>'+
   '<span class="ph-count">'+s.n+' PR</span><span class="ph-chevron">⌄</span></summary>'+
   '<div class="ph-subdetail"><p>'+e(step[3])+'</p>'+
   '<div class="ph-substats"><span>Среднее: <b>'+fmt(s.mean)+' мин</b></span><span>Медиана: <b>'+fmt(s.median)+' мин</b></span><span>P90: <b>'+fmt(s.p90)+' мин</b></span></div>'+
   '<p>Измерено: <b>'+s.n+' из '+denom+' смерженных PR</b> в выбранном окне создания. Нужны две подтверждённые последовательные отметки. Источник: '+e(source)+'.</p>'+
   '<p>Ответственный процесс: '+e(step[4])+'.'+(!s.n?' Для этого перехода подтверждённых пар нет; нулевая длительность не предполагается.':'')+'</p>'+
   '<div class="ph-sample-title">Самые долгие измеренные PR</div>'+detailSamples(row.rows,6)+'</div></details>';
 }
 function phaseHTML(g,i,denom,additive){
  const s=g.statistics,open=openGroups.has(g.id);
  const first=i===0, last=i===4;
  const fullName=first?'Создан → Очередь CI':g.desc;
  const primary='<div class="ph-direct"><div><b>'+e(fullName)+'</b><small>Подтверждённый полный интервал</small></div>'+
    '<strong>'+fmt(s.mean)+' <small>мин</small></strong><span>'+s.n+'/'+denom+' PR</span></div>';
  const drill=first?'<details class="ph-optional"><summary>Необязательные действия: Ready / Triage / Repair <span>⌄</span></summary>'+
    '<p class="ph-note">Это исключения и дополнительные операции. Они не нужны каждому PR и не заменяют полный замер от создания до CI.</p>'+
    g.substeps.map(r=>substepHTML(r,denom)).join('')+'</details>':
    (g.substeps.length?'<details class="ph-optional"><summary>Технические метки и источник <span>⌄</span></summary>'+
     g.substeps.map(r=>substepHTML(r,denom)).join('')+'</details>':'');
  return '<details class="ph-phase" data-phase="'+e(g.id)+'"'+(open?' open':'')+'><summary>'+
    '<span class="ph-number">'+(i+1)+'</span><span class="ph-phase-title"><strong>'+e(g.title)+'</strong><small>'+e(g.desc)+'</small></span>'+
    '<span class="ph-phase-value"><b>'+fmt(s.mean)+'</b><small>'+(s.n?'мин · ':'не измерено · ')+s.n+'/'+denom+' PR</small></span><span class="ph-chevron">⌄</span></summary>'+
    '<div class="ph-body">'+primary+
    '<p class="ph-phase-metrics">Среднее '+fmt(s.mean)+' мин · медиана '+fmt(s.median)+' мин · P90 '+fmt(s.p90)+' мин. '+
    (s.n?'Измерено '+s.n+' из '+denom+' смерженных PR.':'Нет PR с двумя проверенными временными метками.')+'</p>'+
    (last?'<p class="ph-note">LIVE происходит после merge и не входит в среднее Created → Merged.</p>':'')+
    detailSamples(g.rows,5)+drill+'</div></details>';
 }
 function headingControls(){
  return '<div class="ph-filters"><div class="ph-period" role="group" aria-label="Период создания PR">'+HOUR_OPTIONS.map(h=>
    '<button type="button" data-period="'+h+'" class="'+(hours===h?'ph-selected':'')+'">'+h+' ч</button>').join('')+'</div>'+
   '<div class="ph-scope" role="group" aria-label="Ветка PR">'+
   '<button type="button" data-scope="all" class="'+(scope==='all'?'ph-selected':'')+'">Все PR</button>'+
   '<button type="button" data-scope="prod" class="'+(scope==='prod'?'ph-selected':'')+'">Production</button></div></div>';
 }

 // A separate, timestamp-backed source-history audit. This is NOT a clock of
 // continuous developer activity: commit timestamps are not GitHub push times.
 function auditParts(a){
  const counts=[0,0,0,0,0,0],sums=[0,0,0,0,0,0],audited=[],notAudited=[];
  const refs=new Map((headAudit&&headAudit.records||[]).map(r=>[Number(r.pr),r]));
  for(const p of a.select.merged){
   const cr=ts(p.created_at),me=ts(p.merged_at),total=delta(cr,me),rec=refs.get(Number(p.number));
   if(total===null)continue;
   let pointer=cr;
   const good=rec&&rec.created_at===p.created_at&&rec.merged_at===p.merged_at&&
    /^[a-f0-9]{40}$/i.test(rec.head_sha||'')&&(!p.head_sha||p.head_sha===rec.head_sha)&&
    /^https:\/\/github\.com\/andylitvinov-design\/books\/commit\/[a-f0-9]{40}$/i.test(rec.commit_url||'');
   const head=good?ts(rec.head_commit_at):null;
   if(head===null||head<cr||head>me){counts[5]++;sums[5]+=total;notAudited.push({p,total,created:cr,merged:me});continue}
   counts[0]++;sums[0]+=(head-cr)/60000;pointer=head;
   const runner=ts(rec.last_head_first_successful_job_at);
   const gate=ts(rec.last_head_merge_gate_green_at);
   const runnerLink=rec.runner_job_url||'',gateLink=rec.merge_gate_job_url||'';
   const validRun=runner!==null&&runner>=head&&runner<=me&&
    /^https:\/\/github\.com\/andylitvinov-design\/books\/actions\/runs\/\d+\/job\/\d+$/.test(runnerLink);
   const validGate=validRun&&gate!==null&&gate>=runner&&gate<=me&&
    /^https:\/\/github\.com\/andylitvinov-design\/books\/actions\/runs\/\d+\/job\/\d+$/.test(gateLink);
   if(validRun){
    counts[1]++;sums[1]+=(runner-head)/60000;pointer=runner;
    if(validGate){
     counts[2]++;counts[3]++;
     sums[2]+=(gate-runner)/60000;sums[3]+=(me-gate)/60000;pointer=me;
    }
   }
   if(pointer<me){counts[4]++;sums[4]+=(me-pointer)/60000}
   audited.push({p,rec,head,runner:validRun?runner:null,gate:validGate?gate:null,created:cr,merged:me,total,pre:(head-cr)/60000,post:(me-head)/60000});
  }
  const n=a.total.n||1,means=sums.map(x=>x/n);
  return {n:a.total.n,counts,sums,means,audited:audited.sort((x,y)=>y.total-x.total),notAudited:notAudited.sort((x,y)=>y.total-x.total),sum:means.reduce((x,y)=>x+y,0)};
 }
 function auditedCompositionCard(a){
  if(!a.total.n)return '<section class="ph-composition ph-empty"><h3>Где проходит время до merge</h3><p class="ph-note">За этот период завершённых PR нет. Выберите больший период.</p></section>';
  const b=auditParts(a),data=[
   ['До последнего коммита PR','Создание → дата последнего коммита; включает разработку, повторные исправления и ожидания. Не равно времени непрерывной работы.'],
   ['После коммита → старт Runner','Изменение финального SHA → первый подтверждённый успешный job на этом SHA.'],
   ['Финальные проверки до Merge Gate','Первый job → успешный hh-merge-check. Включает ожидания между проверками, не равно расходу runner-минут.'],
   ['Merge Gate → Merged','Успешный защитный GitHub check → фактическое слияние.'],
   ['После коммита: недостаточно меток CI','Остаток известного PR после последнего коммита без подтверждённого полного маршрута Runner → Gate → Merge.'],
   ['Нет проверенной даты финального коммита','Длительность PR, для которых последняя коммитная метка отсутствует или недостоверна.']
  ];
  const table=data.map(([name,note],i)=>'<tr'+(i>=4?' class="ph-unallocated"':'')+'><td><strong>'+(i+1)+'. '+e(name)+'</strong>'+
   '<small>'+e(note)+'</small><small>Проверено: '+b.counts[i]+' из '+a.total.n+' PR</small></td>'+
   '<td class="ph-stage-value">'+moneyMin(b.means[i])+'<small>мин/PR</small></td></tr>').join('');
  const top=b.audited.slice(0,12).map(x=>{
   const u='https://github.com/andylitvinov-design/books/pull/'+Number(x.p.number);
   const timeline=[
    ['Создан',x.created,u],
    ['Последний коммит',x.head,x.rec.commit_url],
    ['Первый успешный job финального HEAD',x.runner,x.rec.runner_job_url],
    ['Merge Gate зелёный',x.gate,x.rec.merge_gate_job_url],
    ['Merged',x.merged,u]
   ].filter(([,at])=>at!==null);
   return '<details class="ph-timeline-pr"><summary><b>PR #'+Number(x.p.number)+'</b><span>'+fmt(x.total)+' мин всего</span><span>'+fmt(x.pre)+' до коммита</span><span>⌄</span></summary>'+
    '<div class="ph-timeline-body">'+timeline.map(([label,at,url])=>'<div><span>'+e(label)+'</span>'+
     '<a href="'+e(url)+'" target="_blank" rel="noopener noreferrer">'+e(human(new Date(at).toISOString()))+'</a></div>').join('')+
    '<p>После последнего коммита до merge: <b>'+fmt(x.post)+' мин</b>. Это не обязательно время очереди CI; источники перечислены выше.</p></div></details>';
  }).join('');
  const preview=b.audited.slice(0,4).map(x=>
   '<div class="ph-long-pr"><a href="https://github.com/andylitvinov-design/books/pull/'+Number(x.p.number)+'" target="_blank" rel="noopener noreferrer">PR #'+Number(x.p.number)+'</a>'+
   '<strong>'+fmt(x.pre)+' мин до коммита</strong><small>Создан '+e(human(new Date(x.created).toISOString()))+
   ' → последний код '+e(human(new Date(x.head).toISOString()))+' → merge '+e(human(new Date(x.merged).toISOString()))+'</small></div>').join('');
  const missing=b.notAudited.slice(0,5).map(x=>
   '<div class="ph-long-pr"><a href="https://github.com/andylitvinov-design/books/pull/'+Number(x.p.number)+'" target="_blank" rel="noopener noreferrer">PR #'+Number(x.p.number)+'</a>'+
   '<strong>'+fmt(x.total)+' мин без этапов</strong><small>'+e(human(new Date(x.created).toISOString()))+
   ' → '+e(human(new Date(x.merged).toISOString()))+'</small></div>').join('');
  return '<section class="ph-composition" data-role="evidence-decomposition">'+
   '<div class="ph-decomp-title"><h3>Где прошло время до merge</h3><span>Одна выборка: '+a.total.n+' PR</span></div>'+
   '<p class="ph-decomp-guide">Восстановлено по проверяемым датам последнего коммита и GitHub Actions. Это <b>временные границы, а не догадки о причинах задержки</b>. Все строки используют один знаменатель — '+a.total.n+' PR.</p>'+
   '<table class="ph-breakdown-table"><thead><tr><th>Период</th><th>Вклад</th></tr></thead>'+
   '<tbody>'+table+'<tr class="ph-breakdown-total"><td><strong>Итого Created → Merged</strong><small>Среднее по '+a.total.n+' смерженным PR</small></td><td class="ph-stage-value">'+moneyMin(a.total.mean)+'<small>мин/PR</small></td></tr></tbody></table>'+
   '<p class="ph-decomp-note"><b>Охват истории: '+b.audited.length+' / '+a.total.n+' PR</b>. GitHub-коммит датирован в GitHub, но время фактического push может отличаться. Значения «нет меток» нельзя считать простоями. Время LIVE после merge здесь не участвует.</p>'+
   '<div class="ph-proof-preview"><h4>Когда: самые долгие проверенные PR</h4>'+preview+'</div>'+
   (missing?'<details class="ph-proof-list"><summary>Где пока нет достоверной истории: '+b.notAudited.length+' PR <span>⌄</span></summary><div class="ph-proof-rows">'+missing+'</div></details>':'')+
   '<details class="ph-proof-list"><summary>Когда именно: '+Math.min(12,b.audited.length)+' самых долгих PR с датами и ссылками <span>⌄</span></summary>'+
   '<div class="ph-proof-rows">'+top+'</div></details>'+
   '<p class="ph-foot-proof">Источник: GitHub PR commits + exact-HEAD Actions; аудит '+e(human(headAudit.recorded_at))+'. '+(Math.abs(b.sum-a.total.mean)>0.01?'ОШИБКА арифметики, требуется проверка.':'Сумма интервалов проверена.')+'</p>'+
   '</section>';
 }
 function compositionCard(a){
  if(headAudit&&Array.isArray(headAudit.records))return auditedCompositionCard(a);
  if(!a.total.n)return '<section class="ph-composition ph-empty" data-role="decomposition"><h3>Из чего складывается среднее до merge</h3>'+
   '<p class="ph-note">За выбранный период пока нет PR, которые успели пройти Created → Merged. Выберите больший период: отсутствие завершённых PR не означает ноль минут.</p></section>';
  const groups=a.groups.filter(g=>g.end<=9),total=a.total.mean,unallocated=a.unknownAverage;
  const observedSum=groups.reduce((acc,g)=>acc+(g.contribution||0),0);
  const residualCheck=Math.abs(observedSum+unallocated-total);
  const counts=groups.map(g=>g.statistics.n);
  const bar=groups.map((g,i)=>g.contribution>0?
    '<span class="ph-bar ph-bar-'+i+'" style="width:'+Math.max(0,100*g.contribution/total).toFixed(5)+'%" title="'+e(g.title)+': '+moneyMin(g.contribution)+' мин/PR"></span>':'').join('')+
    (unallocated>0?'<span class="ph-bar ph-bar-unknown" style="width:'+Math.max(0,100*unallocated/total).toFixed(5)+'%" title="Без подтверждённых переходов: '+moneyMin(unallocated)+' мин/PR"></span>':'');
  const rows=groups.map((g,i)=>
   '<tr><td><div class="ph-stage-label"><span class="ph-key ph-key-'+i+'"></span><strong>'+(i+1)+'. '+e(g.title)+'</strong></div>'+
   '<small>'+(g.statistics.n?'Замер этапа: '+fmt(g.statistics.mean)+' мин · '+g.statistics.n+'/'+a.total.n+' PR':'Пока нет пар временных меток')+'</small></td>'+
   '<td class="ph-stage-value">'+(g.statistics.n?'+'+moneyMin(g.contribution):'—')+'<small>мин/PR</small></td></tr>').join('');
  return '<section class="ph-composition" data-role="decomposition">'+
   '<div class="ph-decomp-title"><h3>Разложение среднего до merge</h3><span>Одна выборка: '+a.total.n+' PR</span></div>'+
   '<p class="ph-decomp-guide">Правая колонка — <b>вклад в среднее время одного PR</b>, а не среднее выбранных PR с метками. По этим строкам можно проверить итог.</p>'+
   '<div class="ph-bars" role="img" aria-label="Подтверждённые участки и нераспределённое время">'+bar+'</div>'+
   '<table class="ph-breakdown-table"><thead><tr><th scope="col">Составляющая</th><th scope="col">Вклад</th></tr></thead>'+
   '<tbody>'+rows+
   '<tr class="ph-unallocated"><td><div class="ph-stage-label"><span class="ph-key ph-key-unknown"></span><strong>Не распределено — нет меток</strong></div>'+
   '<small>Реальное время внутри Created → Merged, для которого пока нет достоверных границ этапов</small></td>'+
   '<td class="ph-stage-value">'+moneyMin(unallocated)+'<small>мин/PR</small></td></tr>'+
   '<tr class="ph-breakdown-total"><td><strong>Итого Created → Merged</strong><small>Среднее по '+a.total.n+' завершённым PR</small></td>'+
   '<td class="ph-stage-value"><b>'+moneyMin(total)+'</b><small>мин/PR</small></td></tr>'+
   '</tbody></table>'+
   '<p class="ph-decomp-note">Вклад = сумма подтверждённых минут этапа / '+a.total.n+' PR. Остальное входит в «Не распределено», а не подменяется нулём. Публикация LIVE измеряется после merge отдельно. Возможна разница 0,01 мин из-за округления.</p>'+
   (residualCheck>0.01?'<p class="ph-warning">Внутренняя проверка разбивки не сошлась. Не используйте сумму строк до проверки.</p>':'')+
   '</section>';
 }
 function holdersCard(a){
  const refs=byPr(),open=a.select.pending.slice().sort((x,y)=>ts(x.created_at)-ts(y.created_at)).slice(0,8);
  return '<details class="ph-extra"><summary>Незавершённые PR в выбранном периоде <b>'+a.select.pending.length+'</b><span>⌄</span></summary>'+
   '<p class="ph-note">Возраст PR — не доказанная длительность блокировки и не включён в среднее Created → Merged.</p>'+
   (open.length?'<div class="ph-holders">'+open.map(p=>{
     const r=refs.get(Number(p.number));
     const times=IDS.slice(0,9).filter(k=>r&&r.stamps&&r.stamps[k]&&r.stamps[k].verified===true)
         .map(k=>({key:k,t:ts(r.stamps[k].at)})).filter(x=>x.t!==null).sort((x,y)=>y.t-x.t);
     const last=times[0]?.key||'created';
     return '<div class="ph-holder">'+link(p)+'<span>'+e(last)+'</span><span>'+fmt(delta(ts(p.created_at),a.select.asOf))+' мин с создания</span></div>';
   }).join('')+'</div>':'<p class="ph-note">Нет открытых PR в этом периоде.</p>')+'</details>';
 }
 function render(){
  if(!host)return;
  if(error){host.innerHTML='<h2>Этапы PR до LIVE</h2><p class="ph-warning">Данные временно недоступны: '+e(error)+'. Другие разделы монитора не затронуты.</p><button data-reload="1">Повторить</button>';return}
  if(!cohortData&&!ledger){host.innerHTML='<h2>Этапы PR до LIVE</h2><p class="ph-muted">Загрузка подтверждённых событий GitHub…</p>';return}
  const a=analysis(),s=a.select,ci=a.select.merged.filter(p=>{const r=byPr().get(Number(p.number));return r&&r.ci&&r.ci.checked===true});
  const repeats=ci.reduce((count,p)=>{const r=byPr().get(Number(p.number)),cycles=r.ci.cycles||[];return count+cycles.reduce((n,x)=>n+Math.max(0,Number(x.run_attempt||x.attempt||1)-1),0)},0);
  const dup=ci.reduce((n,p)=>n+number(byPr().get(Number(p.number)).ci.duplicate_checks),0);
  const m=a.total;
  host.innerHTML='<div class="ph-header"><div><small>PR MONITOR · ПО ЭТАПАМ</small><h2>Этапы PR до LIVE</h2><p>Среднее время <b>от создания до merge</b> и подробная хронология под ним. Нажмите на категорию, затем на подэтап.</p></div>'+
   headingControls()+'</div>'+
   '<section class="ph-hero"><div class="ph-window"><strong>Период создания PR: '+hours+' ч</strong><span>'+human(new Date(s.begin).toISOString())+' — '+human(new Date(s.asOf).toISOString())+' · Торонто</span><small>Среднее только по PR, созданным за этот период и успевшим смержиться к концу периода.</small></div><div class="ph-herotitle">Среднее время одного PR от создания до merge</div>'+
   '<div class="ph-headstats"><div class="ph-total-primary"><small>Created → Merged · среднее на 1 PR</small><strong>'+fmt(m.mean)+' <em>мин</em></strong><span><b>'+m.n+' PR</b> с подтверждёнными created_at и merged_at · медиана '+fmt(m.median)+' мин · P90 '+fmt(m.p90)+' мин</span></div>'+
   '<div class="ph-total-live"><small>От создания до LIVE (отдельно)</small><strong>'+fmt(a.live.mean)+' <em>мин</em></strong><span>'+a.live.n+' PR с проверенным LIVE</span></div></div>'+
   '<p class="ph-summary"><b>Создано '+s.all.length+' PR</b> · <b>Смержено '+s.merged.length+'</b> · <b>Ещё открыто '+s.pending.length+'</b> · закрыто без merge '+s.closed.length+
   '. Среднее рассчитано по <b>'+m.n+' завершённым PR</b> из когорты созданных за '+hours+' ч.</p></section>'+
   compositionCard(a)+
   '<div class="ph-category-head"><h3>Технические этапы CI</h3><span>Отдельная статистика по PR с метками</span></div>'+
   '<div class="ph-categories">'+a.groups.map((g,i)=>phaseHTML(g,i,m.n,g.contribution)).join('')+'</div>'+
   '<section class="ph-post"><h3>Повторы CI и потери</h3>'+
   '<div class="ph-postrow"><span>PR с собранной CI-телеметрией</span><b>'+ci.length+' / '+s.merged.length+'</b></div>'+
   '<div class="ph-postrow"><span>Повторы запусков (из наблюдаемых)</span><b>'+ (ci.length?repeats:'—')+'</b></div>'+
   '<div class="ph-postrow"><span>Дублирующиеся checks (из наблюдаемых)</span><b>'+ (ci.length?dup:'—')+'</b></div>'+
   '<p class="ph-note">Недостающие HEAD и неохваченные PR не считаются нулевыми повторами. Triage и Repair — условные маршруты. Отсутствие их меток не означает задержку или ноль минут.</p></section>'+
   holdersCard(a)+
   '<div class="ph-foot"><p>Период по <b>created_at</b>: '+human(new Date(s.begin).toISOString())+' — '+human(new Date(s.asOf).toISOString())+'. Ветка: '+(scope==='all'?'все':'только '+PRODUCTION)+'.</p>'+
   '<p>Источник среднего: '+e(s.source)+'. Журнал подэтапов: '+human(ledger&&ledger.generated_at)+
   ' · timeline '+(ledger&&ledger.coverage&&ledger.coverage.timeline_checked||0)+'/'+(ledger&&ledger.prs&&ledger.prs.length||0)+
   ' · CI '+(ledger&&ledger.coverage&&ledger.coverage.ci_checked||0)+'/'+(ledger&&ledger.prs&&ledger.prs.length||0)+'.</p>'+
   '<p>Детализация неполная: подтверждено чтение timeline '+(ledger&&ledger.coverage&&ledger.coverage.timeline_checked||0)+' PR за последнее обновление, но полный охват не доказан. Незаписанный интервал никогда не считается нулём. <button type="button" data-reload="1">Обновить данные</button></p></div>';
  window.HHRecentPR?.mount(host);
  window.HHCohortCompare?.mount(host);
 }
 async function load(){
  error=null;render();
  try{
    const results=await Promise.allSettled([
     fetch('/api/pr-created-cohort?hours=48',{headers:{Accept:'application/json'}}).then(async r=>{if(!r.ok)throw Error('cohort HTTP '+r.status);return r.json()}),
     fetch('/api/pr-transition-clock',{headers:{Accept:'application/json'}}).then(async r=>{if(!r.ok)throw Error('ledger HTTP '+r.status);return r.json()}),
     fetch('https://api.github.com/repos/andylitvinov-design/codex-links/contents/telemetry/pr-head-lifecycle-audit.json?ref=telemetry%2Fpr-monitor',
      {headers:{Accept:'application/vnd.github+json'}}).then(async r=>{
       if(!r.ok)throw Error('audit HTTP '+r.status);
       const d=await r.json();
       if(d.encoding!=='base64'||typeof d.content!=='string')throw Error('audit encoding');
       const binary=atob(d.content.replace(/\s/g,'')),buf=Uint8Array.from(binary,c=>c.charCodeAt(0));
       const audit=JSON.parse(new TextDecoder().decode(buf));
       if(audit.schema!=='HH_PR_HEAD_LIFECYCLE_AUDIT_V1'||audit.repo!=='andylitvinov-design/books'||
        !Array.isArray(audit.records)||audit.records.length>500)throw Error('audit schema');
       return audit;
      })
    ]);
    cohortData=results[0].status==='fulfilled'&&Array.isArray(results[0].value.rows)?results[0].value:null;
    ledger=results[1].status==='fulfilled'&&Array.isArray(results[1].value.prs)?results[1].value:null;
    headAudit=results[2].status==='fulfilled'?results[2].value:null;
    auditError=results[2].status==='rejected'?String(results[2].reason?.message||results[2].reason):null;
    if(!cohortData&&!ledger)throw Error('Недоступны GitHub cohort и журнал этапов');
    render();
  }catch(ex){error=String(ex.message||ex);render()}
 }
 function mount(){
  host=document.getElementById('pr-stage-dashboard')||document.getElementById('pr-transition-clock')||document.querySelector('.pr-stage-dashboard');
  if(!host){host=document.createElement('section');(document.querySelector('main')||document.body).appendChild(host)}
  host.id='pr-transition-clock';host.classList.add('pr5-v2');
  // Independent latest-PR read-only visualization from the same GitHub source.
  // CSP permits same-origin assets and direct public github.com API reads.
  const recentStyle=document.createElement('link');
  recentStyle.rel='stylesheet';recentStyle.href='/pr-recent-timing.css';
  document.head.appendChild(recentStyle);
  const recentScript=document.createElement('script');
  recentScript.src='/pr-recent-timing.js';recentScript.defer=true;
  recentScript.onload=()=>window.HHRecentPR?.mount(host);
  document.head.appendChild(recentScript);
  // No new polling: just the existing static monitor and user-triggered GitHub reads.
  const cohortCSS=document.createElement('link');
  cohortCSS.rel='stylesheet';cohortCSS.href='/pr-three-cohorts.css';
  document.head.appendChild(cohortCSS);
  const precommitScript=document.createElement('script');
  precommitScript.src='/pr-precommit-slices.js';precommitScript.defer=true;
  precommitScript.onload=()=>{
   const cohortScript=document.createElement('script');
   cohortScript.src='/pr-three-cohorts.js';cohortScript.defer=true;
   cohortScript.onload=()=>window.HHCohortCompare?.mount(host);
   document.head.appendChild(cohortScript);
  };
  document.head.appendChild(precommitScript);
  // Put the main Created→Merged KPI and its additive breakdown near the top
  // of the page; preserve the existing monitor's other sections and controls.
  const main=host.closest('main')||document.querySelector('main');
  const header=main&&main.querySelector('header.header');
  if(header&&main.contains(host)&&!header.contains(host)&&header.nextElementSibling!==host)
   header.insertAdjacentElement('afterend',host);
  host.addEventListener('click',ev=>{
   const t=ev.target&&ev.target.closest;
   if(!t)return;
   const btn=t.call(ev.target,'button[data-period],button[data-scope],button[data-reload]');
   if(!btn)return;
   if(btn.hasAttribute('data-reload')){load();return}
   if(btn.hasAttribute('data-period')){
    const n=Number(btn.getAttribute('data-period'));if(HOUR_OPTIONS.includes(n)){hours=n;render()}return;
   }
   if(btn.hasAttribute('data-scope')){const next=btn.getAttribute('data-scope');if(['all','prod'].includes(next)){scope=next;render()}}
  });
  host.addEventListener('toggle',ev=>{
    const el=ev.target;
    if(el&&el.hasAttribute&&el.hasAttribute('data-phase')){
     const id=el.getAttribute('data-phase');if(el.open)openGroups.add(id);else openGroups.delete(id);
    }
  },true);
  load();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();