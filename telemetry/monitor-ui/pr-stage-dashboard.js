'use strict';
/* HH_PR_PIPELINE_FIVE_PHASES_V2
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
 const GROUPS=[
  {id:'ready',title:'Создание и готовность',desc:'Created → Ready',start:0,end:1,steps:[0]},
  {id:'triage',title:'Триаж и назначение',desc:'Ready → Triage → Claimed',start:1,end:3,steps:[1,2]},
  {id:'repair',title:'Исправление и публикация',desc:'Claimed → Repair started → Source published',start:3,end:5,steps:[3,4]},
  {id:'ci',title:'Очередь и проверки CI',desc:'Source published → CI queued → Runner started → CI green',start:5,end:8,steps:[5,6,7]},
  {id:'merge',title:'Слияние и LIVE',desc:'CI green → Merged → LIVE verified',start:8,end:9,steps:[8,9]}
 ];
 const IDS=['created','ready','triage','claimed','repair_started','source_published','CI_queued','runner_started','CI_green','merged','LIVE_verified'];
 const e=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':'&#39;');
 const ts=v=>{const n=Date.parse(v||'');return Number.isFinite(n)?n:null};
 const fmt=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:1}):'—';
 const delta=(a,b)=>a!==null&&b!==null&&b>=a?(b-a)/60000:null;
 const human=v=>v?new Date(v).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
 const link=p=>'<a href="https://github.com/andylitvinov-design/books/pull/'+Number(p.number)+'" target="_blank" rel="noopener noreferrer">#'+Number(p.number)+'</a>';
 const number=v=>Number.isFinite(v)?v:0;
 const PRODUCTION='codex/public-book-library';
 let host=null,ledger=null,cohortData=null,hours=24,scope='all',openGroups=new Set(['ready']),error=null;
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
   const segments=[];
   const attribution=GROUPS.map(()=>0);
   for(let i=0;i<9;i++){
    const duration=delta(times[i],times[i+1]);
    if(duration===null)continue;
    segments.push({i,a:times[i],b:times[i+1],minutes:duration});
   }
   segments.sort((a,b)=>a.i-b.i);
   let previousEnd=-Infinity,known=0;
   for(const s of segments){
    if(s.a<previousEnd){invalidSpans++;continue}
    previousEnd=s.b;
    const groupIndex=GROUPS.findIndex(g=>g.steps.includes(s.i));
    known+=s.minutes;
    attribution[groupIndex]+=s.minutes;
    verifiedSteps[s.i].push({p,minutes:s.minutes,stamp:rec&&rec.stamps&&rec.stamps[STEPS[s.i][1]]});
    touched.add(p.number);
   }
   const livePart=delta(times[9],times[10]);
   if(livePart!==null)verifiedSteps[9].push({p,minutes:livePart,stamp:rec&&rec.stamps&&rec.stamps.LIVE_verified});
   GROUPS.forEach((g,i)=>{
    const a=times[g.start],b=times[g.end],duration=delta(a,b);
    if(duration!==null)groupValues[i].push({p,minutes:duration,partial:g.steps.some(k=>k<9&&!verifiedSteps[k].some(x=>x.p.number===p.number))});
    contrib[i]+=attribution[i];
   });
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
     observedPRs:ended.filter(p=>group.steps.some(k=>verifiedSteps[k].some(r=>r.p.number===p.number))).length};
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
   '<span class="ph-time">'+(s.n?statTitle(s):'—')+'</span>'+
   '<span class="ph-count">'+s.n+' PR</span><span class="ph-chevron">⌄</span></summary>'+
   '<div class="ph-subdetail"><p>'+e(step[3])+'</p>'+
   '<div class="ph-substats"><span>Среднее: <b>'+fmt(s.mean)+' мин</b></span><span>Медиана: <b>'+fmt(s.median)+' мин</b></span><span>P90: <b>'+fmt(s.p90)+' мин</b></span></div>'+
   '<p>Измерено: <b>'+s.n+' / '+denom+' смерженных PR</b>. Ответственный процесс: '+e(step[4])+'. Источник: '+e(source)+'.</p>'+
   '<div class="ph-sample-title">Самые долгие измеренные PR</div>'+detailSamples(row.rows,6)+'</div></details>';
 }
 function phaseHTML(g,i,denom,additive){
  const s=g.statistics,open=openGroups.has(g.id);
  const measured=s.n?'Среднее по '+s.n+' PR':'Нет полного измерения';
  const partial=g.observedPRs>0?('Подтверждены части: '+g.observedPRs+' PR'):'Нет подтверждённых подэтапов';
  return '<details class="ph-phase" data-phase="'+e(g.id)+'"'+(open?' open':'')+'><summary>'+
   '<span class="ph-number">'+(i+1)+'</span><span class="ph-phase-title"><strong>'+e(g.title)+'</strong><small>'+e(g.desc)+'</small></span>'+
   '<span class="ph-phase-value"><b>'+fmt(s.mean)+'</b><small>мин · '+s.n+' PR</small></span><span class="ph-chevron">⌄</span></summary>'+
   '<div class="ph-body"><p class="ph-intro">'+e(measured)+' · '+e(partial)+'.'+(i===4?' Среднее группы относится только к CI green → Merged; публикация LIVE указана отдельно.':'')+'</p>'+
   '<div class="ph-subhead"><span>Подэтап (нажмите для деталей)</span><span>Среднее</span><span>PR</span></div>'+
   g.substeps.map(r=>substepHTML(r,denom)).join('')+
   '<p class="ph-coverage">Среднее для полностью измеренной категории: <b>'+fmt(s.mean)+' мин</b>, медиана <b>'+fmt(s.median)+' мин</b> (n='+s.n+'). '+
   'Подтверждённый вклад в общую среднюю Created → Merged: <b>'+fmt(additive)+' мин</b> на PR при единой выборке n='+denom+'. Эти две величины нельзя смешивать.</p>'+
   '</div></details>';
 }
 function headingControls(){
  return '<div class="ph-filters"><div class="ph-period" role="group" aria-label="Период создания PR">'+HOUR_OPTIONS.map(h=>
    '<button type="button" data-period="'+h+'" class="'+(hours===h?'ph-selected':'')+'">'+h+' ч</button>').join('')+'</div>'+
   '<div class="ph-scope" role="group" aria-label="Ветка PR">'+
   '<button type="button" data-scope="all" class="'+(scope==='all'?'ph-selected':'')+'">Все PR</button>'+
   '<button type="button" data-scope="prod" class="'+(scope==='prod'?'ph-selected':'')+'">Production</button></div></div>';
 }
 function compositionCard(a){
  if(!a.total.n)return '<p class="ph-note">В выбранном периоде пока нет смерженных PR; разложение времени недоступно.</p>';
  const breakdown=a.groups.map(g=>({id:g.id,name:g.title,value:g.contribution,observed:g.observedPRs}));
  const totalAvg=a.total.mean,unknown=number(a.unknownAverage);
  const parts=breakdown.map((p,i)=>({...p,index:i,width:totalAvg>0?Math.max(0,100*p.value/totalAvg):0}));
  const unknownWidth=totalAvg>0?Math.max(0,100*unknown/totalAvg):0;
  const equal=parts.reduce((sum,p)=>sum+p.value,0)+unknown;
  return '<section class="ph-composition"><h3>Из чего складывается среднее время до merge</h3>'+
   '<p class="ph-muted">Все слагаемые ниже рассчитаны по <b>одной и той же</b> группе из '+a.total.n+' смерженных PR, созданных в выбранный период.</p>'+
   '<div class="ph-equation"><strong>'+fmt(totalAvg)+' мин</strong><span>=</span><b>'+fmt(a.knownAverage)+' мин</b><span>подтверждённые участки</span><b>+</b><b>'+fmt(a.unknownAverage)+' мин</b><span>время без детальных меток</span></div>'+
   '<div class="ph-bars" aria-label="Распределение известных и неизвестных временных интервалов">'+
   parts.map(p=>p.value>0?'<span class="ph-bar ph-bar-'+p.index+'" style="width:'+p.width.toFixed(5)+'%" title="'+e(p.name)+' — '+fmt(p.value)+' мин"></span>':'').join('')+
   (unknownWidth>0?'<span class="ph-bar ph-bar-unknown" style="width:'+unknownWidth.toFixed(5)+'%" title="Не распределено по этапам — '+fmt(unknown)+' мин"></span>':'')+
   '</div>'+
   '<div class="ph-contributions">'+parts.map((p,i)=>
   '<div><span class="ph-key ph-key-'+i+'"></span><span>'+e(p.name)+'</span><strong>'+ (p.observed?fmt(p.value)+' мин':'—')+'</strong><small>'+p.observed+' PR</small></div>').join('')+
   '<div class="ph-contribution-unknown"><span class="ph-key ph-key-unknown"></span><span>Не распределено (нет меток)</span><strong>'+fmt(unknown)+' мин</strong><small>остаток</small></div></div>'+
   '<p class="ph-note">Вклад этапа — только подтверждённые последовательные интервалы, делённые на общее количество смерженных PR. Отсутствующая метка <b>не означает ноль минут</b>: её время включено в нераспределённый остаток. Разные выборки из раскрытых карточек складывать нельзя.</p>'+
   (Math.abs(equal-totalAvg)>0.05?'<p class="ph-warning">Проверка арифметики: есть несовпадение; часть событий требует дополнительной проверки.</p>':'')+
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
   '<section class="ph-hero"><div class="ph-herotitle">Средняя длительность нового PR</div>'+
   '<div class="ph-headstats"><div><small>Created → Merged</small><strong>'+fmt(m.mean)+' <em>мин</em></strong><span>Медиана '+fmt(m.median)+' мин · P90 '+fmt(m.p90)+' мин</span></div>'+
   '<div><small>Created → LIVE verified</small><strong>'+fmt(a.live.mean)+' <em>мин</em></strong><span>'+a.live.n+' PR с проверенной LIVE-версией</span></div></div>'+
   '<p class="ph-summary"><b>Создано '+s.all.length+' PR</b> · <b>Смержено '+s.merged.length+'</b> · <b>Ещё открыто '+s.pending.length+'</b> · закрыто без merge '+s.closed.length+
   '. Среднее рассчитано по <b>'+m.n+' завершённым PR</b> из когорты созданных за '+hours+' ч.</p></section>'+
   compositionCard(a)+
   '<div class="ph-category-head"><h3>5 основных этапов</h3><span>Средняя длительность · число измеренных PR</span></div>'+
   '<div class="ph-categories">'+a.groups.map((g,i)=>phaseHTML(g,i,m.n,g.contribution)).join('')+'</div>'+
   '<section class="ph-post"><h3>Повторы CI и потери</h3>'+
   '<div class="ph-postrow"><span>PR с собранной CI-телеметрией</span><b>'+ci.length+' / '+s.merged.length+'</b></div>'+
   '<div class="ph-postrow"><span>Повторы запусков (из наблюдаемых)</span><b>'+ (ci.length?repeats:'—')+'</b></div>'+
   '<div class="ph-postrow"><span>Дублирующиеся checks (из наблюдаемых)</span><b>'+ (ci.length?dup:'—')+'</b></div>'+
   '<p class="ph-note">Недостающие HEAD и неохваченные PR не считаются нулевыми повторами. Этапы Triage/Repair могут отсутствовать, если их события не были инструментированы.</p></section>'+
   holdersCard(a)+
   '<div class="ph-foot"><p>Период по <b>created_at</b>: '+human(new Date(s.begin).toISOString())+' — '+human(new Date(s.asOf).toISOString())+'. Ветка: '+(scope==='all'?'все':'только '+PRODUCTION)+'.</p>'+
   '<p>Источник среднего: '+e(s.source)+'. Журнал подэтапов: '+human(ledger&&ledger.generated_at)+
   ' · timeline '+(ledger&&ledger.coverage&&ledger.coverage.timeline_checked||0)+'/'+(ledger&&ledger.prs&&ledger.prs.length||0)+
   ' · CI '+(ledger&&ledger.coverage&&ledger.coverage.ci_checked||0)+'/'+(ledger&&ledger.prs&&ledger.prs.length||0)+'.</p>'+
   '<p>Пустые значения — недостаточно подтверждённых временных отметок, не 0 минут. <button type="button" data-reload="1">Обновить данные</button></p></div>';
 }
 async function load(){
  error=null;render();
  try{
    const results=await Promise.allSettled([
     fetch('/api/pr-created-cohort?hours=48',{headers:{Accept:'application/json'}}).then(async r=>{if(!r.ok)throw Error('cohort HTTP '+r.status);return r.json()}),
     fetch('/api/pr-transition-clock',{headers:{Accept:'application/json'}}).then(async r=>{if(!r.ok)throw Error('ledger HTTP '+r.status);return r.json()})
    ]);
    cohortData=results[0].status==='fulfilled'&&Array.isArray(results[0].value.rows)?results[0].value:null;
    ledger=results[1].status==='fulfilled'&&Array.isArray(results[1].value.prs)?results[1].value:null;
    if(!cohortData&&!ledger)throw Error('Недоступны GitHub cohort и журнал этапов');
    render();
  }catch(ex){error=String(ex.message||ex);render()}
 }
 function mount(){
  host=document.getElementById('pr-stage-dashboard')||document.getElementById('pr-transition-clock')||document.querySelector('.pr-stage-dashboard');
  if(!host){host=document.createElement('section');(document.querySelector('main')||document.body).appendChild(host)}
  host.id='pr-transition-clock';host.classList.add('pr5-v2');
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