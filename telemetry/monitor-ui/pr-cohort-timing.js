'use strict';
/* HH_PR_COHORT_CORE_WAVE_EVIDENCE_V1.
 * Exact PR, HEAD commit-list, and GitHub Core workflow evidence. All displayed
 * durations are wall-clock intervals, never inferred runner cost or inactivity.
 * No token, no cron, no paid API; bounded reads on explicitly viewed pages.
 */
(()=>{
 if(window.HHCohortTimeline)return;
 const GH='https://api.github.com/repos/andylitvinov-design/books';
 const NAMES={
  before_core:['До первой попытки Core CI','От создания PR до первой зарегистрированной Core CI'],
  previous_core:['Предыдущие волны Core CI','Время внутри незавершающих волн Core workflow (включая очередь и зависимости)'],
  after_red:['После красной CI → следующая попытка','Время от завершения неуспешной CI до следующей попытки или merge; не доказанный простой'],
  after_cancel:['После отменённой CI → следующая попытка','Время между отменой CI и следующей попыткой; отмена не равна расходу Runner'],
  after_green_repeat:['После успешной CI → следующая попытка','Повторные правки и ожидание после успешной проверки (причина уточняется по PR)'],
  other_gap:['Между попытками: причина не подтверждена','Время между зарегистрированными волнами без установленной причины'],
  final_core:['Финальная волна Core CI','Финальная волна CI на HEAD, который был смержен; workflow wall time'],
  after_final:['После финальной CI → merge','Проверка завершена → GitHub фактически смержил PR'],
  not_verified:['Нет полной проверенной истории Core CI','PR не охвачен или данные GitHub недоступны; эти минуты не приписываются CI']
 };
 const ORDER=['before_core','previous_core','after_red','after_cancel','after_green_repeat','other_gap','final_core','after_final','not_verified'];
 const state={key:null,all:[],limit:12,cache:new Map(),pending:false,apiCalls:0,maxApiCalls:50,
  onUpdate:null,requested:0,error:null,rateLimited:false};
 const ms=x=>{const z=Date.parse(x||'');return Number.isFinite(z)?z:null};
 const okSha=x=>/^[a-f0-9]{40}$/i.test(x||'');
 const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,y=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[y]));
 const dec=x=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
 const fmt=x=>{if(!Number.isFinite(x)||x<0)return '—';const s=Math.round(x*60);
  return s>=3600?Math.floor(s/3600)+' ч '+Math.floor(s%3600/60)+' мин':s>=60?Math.floor(s/60)+' мин '+String(s%60).padStart(2,'0')+' с':s+' с'};
 const date=x=>new Date(x).toLocaleString('ru-RU',{timeZone:'America/Toronto',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 const sampleKey=p=>p.number+'|'+p.created_at+'|'+p.merged_at;
 const total=p=>(ms(p.merged_at)-ms(p.created_at))/60000;
 const safeRunUrl=x=>/^https:\/\/github\.com\/andylitvinov-design\/books\/actions\/runs\/\d+$/.test(x||'')?x:null;
 async function get(path){
  if(state.apiCalls>=state.maxApiCalls)throw Error('Превышен лимит безопасных GitHub-запросов за просмотр');
  state.apiCalls++;
  const r=await fetch(GH+path,{headers:{Accept:'application/vnd.github+json'}});
  if(!r.ok){if(r.status===403||r.status===429)state.rateLimited=true;
   throw Error((r.status===403||r.status===429)?'GitHub API limit; повторите после восстановления лимита':'GitHub HTTP '+r.status)}
  return r.json();
 }
 // Pure evidence partition of Created→Merged. Current HEAD must match last
 // PR commit; each Core workflow HEAD must belong to that PR's commit history.
 function prove(row,pr,commits,history){
  const start=ms(row.created_at),end=ms(row.merged_at);
  if(!Number.isSafeInteger(row.number)||!Number.isFinite(start)||!Number.isFinite(end)||end<start||
   pr?.number!==row.number||pr.created_at!==row.created_at||pr.merged_at!==row.merged_at||
   pr.base?.repo?.full_name!=='andylitvinov-design/books'||!okSha(pr.head?.sha)||
   !Array.isArray(commits)||commits.length===0||commits.length>=100||
   commits.at(-1)?.sha!==pr.head.sha||!Array.isArray(history?.workflow_runs)||
   !Number.isSafeInteger(history.total_count)||history.total_count>=100||
   history.total_count!==history.workflow_runs.length)
   throw Error('Отсутствует полная, совпадающая история PR/HEAD');
  const commitShas=new Set(commits.map(c=>c.sha).filter(okSha).map(x=>x.toLowerCase()));
  const runs=history.workflow_runs.filter(x=>x.name==='HH PR core release gate'&&
   x.event==='pull_request'&&x.head_branch===pr.head.ref&&okSha(x.head_sha)&&
   commitShas.has(x.head_sha.toLowerCase())&&ms(x.created_at)!==null&&ms(x.updated_at)!==null&&
   x.status==='completed'&&ms(x.created_at)>=start&&ms(x.created_at)<end&&
   ms(x.updated_at)>=ms(x.created_at)&&
   ['success','failure','cancelled','timed_out','action_required','skipped'].includes(x.conclusion)
  ).map(x=>({...x,begin:ms(x.created_at),finish:Math.min(ms(x.updated_at),end)}))
   .filter(x=>x.finish>x.begin).sort((a,b)=>a.begin-b.begin);
  if(!runs.length)throw Error('Нет проверенных Core CI-волн для этого PR');
  // A final successful Core workflow must belong to the actual merged HEAD.
  const final=runs.filter(x=>x.head_sha===pr.head.sha&&x.conclusion==='success')
   .sort((a,b)=>b.begin-a.begin)[0];
  if(!final||final.finish>end)throw Error('Финальный успешный Core CI не подтверждён');
  const bounds=[start,end,...runs.flatMap(x=>[x.begin,x.finish])]
   .filter(x=>x>=start&&x<=end).sort((a,b)=>a-b);
  const unique=bounds.filter((x,i)=>i===0||x!==bounds[i-1]);
  const intervals=[],sums=Object.fromEntries(ORDER.map(k=>[k,0]));
  for(let i=0;i<unique.length-1;i++){
   const a=unique[i],b=unique[i+1];if(b<=a)continue;
   const active=runs.filter(x=>x.begin<=a&&x.finish>=b);
   let kind,ref=null;
   if(active.length){
    const chosen=active.find(x=>x.id===final.id)||active.at(-1);
    kind=active.some(x=>x.id===final.id)?'final_core':'previous_core';ref=chosen;
   }else{
    const prior=runs.filter(x=>x.finish<=a).sort((x,y)=>y.finish-x.finish)[0];
    const later=runs.filter(x=>x.begin>=b).sort((x,y)=>x.begin-y.begin)[0];
    if(!prior)kind='before_core';
    else if(!later&&prior.id===final.id)kind='after_final';
    else if(prior.conclusion==='failure'||prior.conclusion==='timed_out')kind='after_red';
    else if(prior.conclusion==='cancelled')kind='after_cancel';
    else if(prior.conclusion==='success')kind=later?'after_green_repeat':'after_final';
    else kind='other_gap';
    ref=prior||later||null;
   }
   const part=(b-a)/60000;sums[kind]+=part;
   const previous=intervals.at(-1);
   if(previous&&previous.kind===kind&&previous.end===a&&
    (previous.ref?.id||null)===(ref?.id||null)){previous.end=b;previous.min+=(b-a)/60000}
   else intervals.push({kind,start:a,end:b,min:part,ref:ref?{id:ref.id,url:safeRunUrl(ref.html_url),
    status:ref.conclusion,head:ref.head_sha}:null});
  }
  const sum=Object.values(sums).reduce((a,b)=>a+b,0);
  if(Math.abs(sum-(end-start)/60000)>.0001)throw Error('Несовпадение сумм временных интервалов');
  const byStatus={green:runs.filter(x=>x.conclusion==='success').length,
   failed:runs.filter(x=>x.conclusion==='failure'||x.conclusion==='timed_out').length,
   cancelled:runs.filter(x=>x.conclusion==='cancelled').length};
  const longest=intervals.filter(x=>x.kind==='after_red').sort((a,b)=>b.min-a.min)[0]||null;
  return {pr:row.number,start,end,head:pr.head.sha,waves:runs.length,byStatus,sums,intervals,
   longestGap:longest,commits:commits.length,source:'GitHub PR commits + exact branch Core workflow runs',
   checked_at:new Date().toISOString()};
 }
 function cohortValue(){
  const n=state.all.length;if(!n)return null;
  const sums=Object.fromEntries(ORDER.map(k=>[k,0]));
  const samples=Object.fromEntries(ORDER.map(k=>[k,new Set()]));
  let covered=0,coveredMinutes=0;const proofs=[];
  for(const p of state.all){
   const value=total(p);if(!Number.isFinite(value)||value<0)continue;
   const entry=state.cache.get(sampleKey(p));
   if(entry?.status==='complete'){
    covered++;coveredMinutes+=value;proofs.push(entry.proof);
    for(const k of ORDER)if(entry.proof.sums[k]>0){sums[k]+=entry.proof.sums[k];samples[k].add(p.number)}
   }else{sums.not_verified+=value;samples.not_verified.add(p.number)}
  }
  const mean=state.all.reduce((s,p)=>s+total(p),0)/n;
  const rowValues=ORDER.map(k=>({key:k,label:NAMES[k][0],info:NAMES[k][1],
   value:sums[k]/n,count:samples[k].size}));
  const summed=rowValues.reduce((s,x)=>s+x.value,0);
  return {n,mean,rows:rowValues,covered,coveredMinutes,totalMinutes:mean*n,
   proofs:proofs.sort((a,b)=>(b.end-b.start)-(a.end-a.start)),additive:Math.abs(summed-mean)<.001};
 }
 async function inspectOne(p){
  try{
   const pr=await get('/pulls/'+p.number);
   if(pr.number!==p.number||pr.created_at!==p.created_at||pr.merged_at!==p.merged_at||
    !pr.head?.ref||!pr.head?.sha||pr.base?.repo?.full_name!=='andylitvinov-design/books')
    throw Error('GitHub PR метаданные не совпали с выбранной выборкой');
   const commits=await get('/pulls/'+p.number+'/commits?per_page=100');
   if(!Array.isArray(commits)||commits.length>=100)throw Error('История коммитов отсутствует или урезана');
   const history=await get('/actions/runs?branch='+encodeURIComponent(pr.head.ref)+'&per_page=100');
   return {status:'complete',proof:prove(p,pr,commits,history)};
  }catch(e){return {status:'partial',error:String(e.message||e).slice(0,170)}}
 }
 function signal(){if(typeof state.onUpdate==='function')state.onUpdate()}
 async function fill(){
  if(state.pending||state.rateLimited)return;
  state.pending=true;
  const list=state.all.slice(0,state.limit).filter(p=>!state.cache.has(sampleKey(p)));
  for(let i=0;i<list.length;i+=2){
   if(state.rateLimited||state.apiCalls>=state.maxApiCalls)break;
   const pairs=await Promise.all(list.slice(i,i+2).map(async p=>({key:sampleKey(p),result:await inspectOne(p)})));
   for(const x of pairs)state.cache.set(x.key,x.result);
   signal();
  }
  state.pending=false;signal();
 }
 function setCohort(select,onUpdate){
  if(!select||!Array.isArray(select.merged))return;
  const key=[select.begin,select.asOf,select.merged.length,select.merged.map(p=>p.number).join(',' )].join('|');
  state.onUpdate=onUpdate;
  if(state.key!==key){
   state.key=key;
   state.all=select.merged.filter(p=>Number.isSafeInteger(p.number)&&p.number>0&&
    ms(p.created_at)!==null&&ms(p.merged_at)!==null&&ms(p.merged_at)>=ms(p.created_at))
    .sort((a,b)=>total(b)-total(a));
   state.limit=Math.min(12,state.all.length);
   state.error=null;
  }
  if(state.all.slice(0,state.limit).some(p=>!state.cache.has(sampleKey(p)))&&
   !state.pending&&!state.rateLimited&&state.apiCalls<state.maxApiCalls)
   void fill();
 }
 function more(){
  if(state.limit>=state.all.length||state.apiCalls+12>state.maxApiCalls)return;
  state.limit=Math.min(state.all.length,state.limit+4);signal();void fill();
 }
 function compose(a){
  if(!state.key||!a.total.n)return null;
  const v=cohortValue();if(!v||!v.n)return null;
  const rows=v.rows.filter(r=>r.value>0||r.key==='not_verified')
   .sort((a,b)=>a.key==='not_verified'?1:b.key==='not_verified'?-1:b.value-a.value);
  const loading=state.pending?'Проверяю '+state.limit+' самых долгих PR… ':'';
  const data=rows.map(r=>'<tr'+(r.key==='not_verified'?' class="ph-unallocated"':'')+'><td><strong>'+esc(r.label)+'</strong>'+
   '<small>'+esc(r.info)+'</small><small>Подтверждено по '+r.count+' PR из '+v.n+'</small></td>'+
   '<td class="ph-stage-value">'+dec(r.value)+'<small>мин/PR</small></td></tr>').join('');
  const hasMore=state.all.length>state.limit&&state.apiCalls+12<=state.maxApiCalls&&!state.rateLimited;
  const top=v.proofs.slice(0,8).map(p=>{
   const gap=p.longestGap;
   const parts=p.intervals.filter(x=>x.min>=.05).sort((a,b)=>b.min-a.min).slice(0,10)
    .map(x=>'<div class="ph-cohort-period"><span>'+esc(NAMES[x.kind][0])+'</span>'+
     '<b>'+fmt(x.min)+'</b><small>'+esc(date(x.start))+' → '+esc(date(x.end))+
     (x.ref?.url?' · <a href="'+esc(x.ref.url)+'" target="_blank" rel="noopener noreferrer">GitHub CI</a>':'')+
     '</small></div>').join('');
   return '<details class="ph-cohort-pr"><summary><a href="https://github.com/andylitvinov-design/books/pull/'+p.pr+
    '" target="_blank" rel="noopener noreferrer">#'+p.pr+'</a><strong>'+fmt((p.end-p.start)/60000)+'</strong>'+
    '<small>'+(gap?'После красной CI: '+fmt(gap.min):'Core CI-волн: '+p.waves)+'</small></summary>'+
    '<div><p>Core CI: '+p.waves+' волн · ошибок '+p.byStatus.failed+
    ' · отмен '+p.byStatus.cancelled+' · успешных '+p.byStatus.green+'. Даты по Торонто.</p>'+parts+
    '<p>Между попытками могли быть изменения кода и ожидания; отсутствие Core CI не доказывает простой.</p></div></details>';
  }).join('');
  return '<section class="ph-composition" data-role="cohort-core-latency">'+
    '<div class="ph-decomp-title"><h3>Куда прошло время до merge</h3><span>Одна выборка: '+v.n+' PR</span></div>'+
    '<p class="ph-decomp-guide">'+loading+'Проверены Core CI-волны и промежутки между ними. Вклад рассчитан по <b>одинаковым '+v.n+' PR</b>, не по разным подвыборкам.</p>'+
    '<p class="ph-cohort-coverage">Восстановлена история <b>'+v.covered+' / '+v.n+' PR</b> · '+
    (v.totalMinutes>0?(100*v.coveredMinutes/v.totalMinutes).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%':'—')+
    ' суммарного времени в выборке. Прочитано GitHub API: '+state.apiCalls+'/'+state.maxApiCalls+'.</p>'+
    '<table class="ph-breakdown-table"><thead><tr><th>Подтверждённый период</th><th>Вклад</th></tr></thead><tbody>'+data+
    '<tr class="ph-breakdown-total"><td><strong>Итого Created → Merged</strong><small>Среднее по '+v.n+' PR</small></td>'+
    '<td class="ph-stage-value">'+dec(v.mean)+'<small>мин/PR</small></td></tr></tbody></table>'+
    '<p class="ph-decomp-note">Красная CI → новая попытка — <b>доказанный интервал между запусками</b>, а не доказанный простой исполнителя. Повторные workflow-волны могут пересекаться: двойной подсчёт исключён.'+
    (v.additive?' Сумма проверена.':' Сумма не сошлась — требуется проверка.')+'</p>'+
    (state.rateLimited?'<p class="ph-warning">GitHub ограничил запросы. Уже проверенные значения сохранены до закрытия страницы.</p>':'')+
    (hasMore?'<button type="button" data-cohort-more="1">Разобрать ещё 4 самых долгих PR</button>':'')+
    '<details class="ph-cohort-examples"><summary>Когда именно: '+v.proofs.length+' PR с проверенной хронологией <span>⌄</span></summary>'+
    top+'</details>'+
    '<p class="ph-foot-proof">Источник: GitHub PR metadata, история коммитов, Core CI workflow runs. Обновление только при открытии или нажатии; новых cron и платных сервисов нет.</p>'+
    '</section>';
 }
 window.HHCohortTimeline={setCohort,compose,more,testing:{prove,cohortValue,NAMES}};
})();
