'use strict';
/* HH_THREE_PR_COHORTS_V1: full created-cohort counts and optional pre-final audit. */
(()=>{
 if(window.HHCohortCompare)return;
 const ROOT='https://api.github.com/repos/andylitvinov-design/books';
 const state={windows:[],at:null,mode:'loading',error:null,target:null,selected:null,details:new Map(),busy:false,lastRequest:0};
 const TIMEZONE='America/Toronto',IDS=['two_weeks_ago','week_ago','last_day'];
 // Audited examples among the slowest PRs, NOT cohort-wide stage averages.
 const representativeGaps={
  two_weeks_ago:[{pr:1318,minutes:81.85},{pr:1307,minutes:79.73},{pr:1329,minutes:38.23}],
  week_ago:[{pr:2275,minutes:540.62},{pr:2367,minutes:410.55},{pr:2369,minutes:384.02}],
  last_day:[{pr:3298,minutes:821.95},{pr:3320,minutes:736.68},{pr:3302,minutes:644.73}]
 };
 const ms=v=>{const n=Date.parse(v||'');return Number.isFinite(n)?n:null};
 const escaped=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:1}):'—';
 const minutes=(a,b)=>ms(a)!==null&&ms(b)!==null&&ms(b)>=ms(a)?(ms(b)-ms(a))/60000:null;
 const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
 const local=v=>new Date(v).toLocaleString('ru-RU',{timeZone:TIMEZONE,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const parts=v=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(v).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 function anchor(now,daysAgo){
  const v=parts(now),wall=Date.UTC(v.year,v.month-1,v.day-daysAgo,v.hour,v.minute),localAt=parts(new Date(wall));
  const inferredOffset=Date.UTC(localAt.year,localAt.month-1,localAt.day,localAt.hour,localAt.minute)-wall;
  return new Date(wall-inferredOffset);
 }
 function rolling(now){
  return [['last_day','Последние сутки',0],['week_ago','Неделю назад',7],['two_weeks_ago','Две недели назад',14]].map(([id,label,ago])=>{
   const end=anchor(now,ago);return {id,label,from:new Date(end.getTime()-86400000).toISOString(),to:end.toISOString()};
  });
 }
 function check(w){
  if(!w||!IDS.includes(w.id)||!Array.isArray(w.rows)||w.rows.length>200||w.complete!==true||w.rows.length!==w.expected_count||ms(w.to)-ms(w.from)!==86400000)return false;
  const numbers=new Set();
  for(const p of w.rows){
   if(!Number.isSafeInteger(p.number)||p.number<1||numbers.has(p.number)||ms(p.created_at)===null||ms(p.created_at)<ms(w.from)||ms(p.created_at)>=ms(w.to))return false;
   numbers.add(p.number);
  }
  return true;
 }
 function summarize(w){
  const end=ms(w.to),rows=w.rows,open=rows.filter(p=>p.closed_at===null||ms(p.closed_at)>end);
  const closed=rows.filter(p=>p.closed_at!==null&&ms(p.closed_at)<=end);
  const merged=closed.filter(p=>p.merged_at&&ms(p.merged_at)<=end);
  const unmerged=closed.length-merged.length;
  const vals=merged.map(p=>minutes(p.created_at,p.merged_at)).filter(x=>x!==null).sort((a,b)=>a-b);
  const slow=merged.map(p=>({...p,duration:minutes(p.created_at,p.merged_at)})).sort((a,b)=>b.duration-a.duration);
  const pending=open.map(p=>({...p,age:(end-ms(p.created_at))/60000})).sort((a,b)=>b.age-a.age);
  return {...w,n:rows.length,merged:merged.length,closed:closed.length,unmerged,open:open.length,pct:100*open.length/rows.length,
   stillOpen:rows.filter(p=>p.state==='open').length,closedLater:rows.filter(p=>p.closed_at&&ms(p.closed_at)>end).length,
   avg:mean(vals),median:vals.length?(vals.length%2?vals[(vals.length-1)/2]:(vals[vals.length/2-1]+vals[vals.length/2])/2):null,
   p90:vals.length?vals[Math.ceil(vals.length*.9)-1]:null,slow:slow.slice(0,5),pending:pending.slice(0,6)};
 }
 async function gh(path){
  if(!path.startsWith(ROOT+'/'))throw Error('Неверный GitHub URL');
  const r=await fetch(path,{headers:{Accept:'application/vnd.github+json'}});
  if(!r.ok)throw Error(r.status===403||r.status===429?'GitHub API: лимит запросов':'GitHub HTTP '+r.status);
  return r.json();
 }
 async function search(w){
  const q='repo:andylitvinov-design/books is:pr created:'+w.from+'..'+w.to;
  async function page(num){
   const url='https://api.github.com/search/issues?q='+encodeURIComponent(q)+'&per_page=100&page='+num+'&sort=created&order=asc';
   const r=await fetch(url,{headers:{Accept:'application/vnd.github+json'}});
   if(!r.ok)throw Error(r.status===403||r.status===429?'GitHub Search: ограничение запросов':'GitHub Search HTTP '+r.status);
   return r.json();
  }
  const one=await page(1);
  if(one.incomplete_results||!Number.isSafeInteger(one.total_count)||one.total_count>200)throw Error('Слишком большая либо неполная выборка '+w.id);
  const two=one.total_count>100?await page(2):{items:[],incomplete_results:false};
  if(two.incomplete_results)throw Error('Неполная вторая страница '+w.id);
  const rows=[...(one.items||[]),...(two.items||[])].filter(p=>ms(p.created_at)>=ms(w.from)&&ms(p.created_at)<ms(w.to))
   .map(p=>({number:p.number,title:String(p.title||'').slice(0,175),created_at:p.created_at,
    closed_at:p.closed_at||null,merged_at:p.pull_request?.merged_at||null,state:p.state}));
  const result={...w,complete:true,expected_count:one.total_count,rows};
  if(!check(result))throw Error('Охват GitHub не подтверждён '+w.id);
  return result;
 }
 async function refresh(){
  if(state.busy||Date.now()-state.lastRequest<90000)return;
  state.busy=true;state.error=null;draw();
  try{
   const fresh=[];for(const w of rolling(new Date()))fresh.push(await search(w));
   state.windows=fresh;state.at=new Date().toISOString();state.details.clear();
  }catch(e){state.error=String(e?.message||e)}
  state.lastRequest=Date.now();state.busy=false;draw();
 }
 async function load(){
  try{
   const res=await fetch('/pr-three-cohorts-snapshot.json',{headers:{Accept:'application/json'}});
   if(!res.ok)throw Error('Snapshot HTTP '+res.status);
   const obj=await res.json();
   if(obj.schema!=='HH_PR_THREE_CREATED_COHORTS_V1'||obj.repo!=='andylitvinov-design/books'||!Array.isArray(obj.windows)||
    obj.windows.length!==3||obj.windows.some(w=>!check(w)))throw Error('Неполный архив исторических PR');
   state.windows=obj.windows;state.at=obj.generated_at;state.mode='ready';
  }catch(e){state.error=String(e?.message||e);state.mode='error'}
  draw();
 }
 function rowPR(p,description){
  return '<div class="phc-pr"><a href="https://github.com/andylitvinov-design/books/pull/'+p.number+'" target="_blank" rel="noopener noreferrer">#'+p.number+'</a>'+
   '<span>'+escaped(p.title)+'</span><strong>'+escaped(description)+'</strong>'+
   '<button type="button" data-pr="'+p.number+'">Этапы</button></div>';
 }
 function windowCard(w){
  return '<article class="phc-window"><h4>'+escaped(w.label)+'</h4><small>'+local(ms(w.from))+' — '+local(ms(w.to))+' Торонто</small>'+
   '<div class="phc-stats"><span>Создано<b>'+w.n+'</b></span><span>Смержено<b>'+w.merged+'</b></span>'+
   '<span>Незакрыто<b>'+w.open+' ('+fmt(w.pct)+'%)</b></span>'+
   '<span>Закрыто без merge<b>'+w.unmerged+'</b></span>'+
   '<span>Среднее до merge<b>'+fmt(w.avg)+' мин</b></span>'+
   '<span>Медиана<b>'+fmt(w.median)+' мин</b></span></div>'+
   '<div class="phc-progress"><span style="width:'+Math.min(100,w.pct).toFixed(3)+'%"></span></div>'+
   '<details><summary>Самые долгие и открытые PR <span>⌄</span></summary>'+
   '<p>Дольше всего до merge:</p>'+w.slow.slice(0,4).map(p=>rowPR(p,fmt(p.duration)+' мин')).join('')+
   '<p>Не закрылись к концу суток:</p>'+w.pending.slice(0,5).map(p=>rowPR(p,fmt(p.age)+' мин возраста')).join('')+
   '</details></article>';
 }
 function analysisCard(){
  if(state.selected===null)return '';
  const id=state.selected,data=state.details.get(id);
  if(!data)return '<section class="phc-evidence">PR #'+id+': читаю историю коммитов, CI и jobs…</section>';
  if(data.error)return '<section class="phc-evidence"><button data-close>Свернуть</button><p class="phc-error">'+escaped(data.error)+'</p></section>';
  const a=data.analysis,tmap=Object.entries(a.totalsSeconds).filter(([,v])=>v>0).sort((x,y)=>y[1]-x[1]);
  return '<section class="phc-evidence"><div class="phc-head"><h4>PR #'+id+' — жизнь до последнего коммита</h4><button data-close>Свернуть</button></div>'+
   '<p><b>Всего '+fmt(a.untilLastCommitSeconds/60)+' мин</b> · найдено '+a.proofCoverage.runCount+
   ' CI-волн, jobs измерены для '+a.proofCoverage.withJobs+'. '+(a.historyPartial?'Неполная/старая система CI.':'Core CI.')+'</p>'+
   '<div class="phc-sums">'+tmap.map(([key,v])=>'<div><span>'+escaped(a.labels[key])+'</span><b>'+fmt(v/60)+' мин</b></div>').join('')+'</div>'+
   '<h5>Точные интервалы и ссылки</h5>'+a.segments.map(s=>'<div class="phc-segment"><strong>'+escaped(s.label)+'</strong><b>'+fmt(s.seconds/60)+' мин</b>'+
    '<small>'+local(s.from)+' → '+local(s.to)+' · '+escaped(s.detail)+'</small>'+
    '<small>'+(s.evidence?'<a href="'+escaped(s.evidence)+'" target="_blank" rel="noopener noreferrer">GitHub Actions</a>':'Нет полной метки')+
    ' · '+escaped(s.quality)+'</small></div>').join('')+
   '<h5>Последние изменения кода</h5>'+a.sourceEvents.slice(-12).map(s=>
    '<div class="phc-source"><a href="https://github.com/andylitvinov-design/books/commit/'+s.sha+'" target="_blank" rel="noopener noreferrer">'+s.sha.slice(0,8)+'</a>'+
    '<span>'+local(s.at)+'</span><small>'+escaped(s.title)+'</small></div>').join('')+
   '<p class="phc-note">Сумма неперекрывающихся участков = '+fmt(a.untilLastCommitSeconds/60)+
   ' мин. Коммит не доказывает время push, а промежуток после CI не означает доказанный простой.</p></section>';
 }
 async function inspect(n){
  if(!Number.isSafeInteger(n)||n<1)return;
  if(state.selected===n&&state.details.has(n)){state.selected=null;draw();return}
  state.selected=n;draw();
  if(state.details.has(n))return;
  try{
   const [pr,commits]=await Promise.all([gh(ROOT+'/pulls/'+n),gh(ROOT+'/pulls/'+n+'/commits?per_page=100')]);
   if(pr.number!==n||!Array.isArray(commits)||!commits.length||commits.length>=100)throw Error('Нет полной истории HEAD/commits');
   const branch=pr.head?.ref;if(!branch||!/^[A-Za-z0-9._/-]{1,160}$/.test(branch))throw Error('Небезопасная ветка PR');
   const runHistory=await gh(ROOT+'/actions/runs?branch='+encodeURIComponent(branch)+'&per_page=100');
   if(!Array.isArray(runHistory.workflow_runs))throw Error('Нет данных о CI');
   const end=Math.max(ms(pr.created_at),ms(commits.at(-1)?.commit?.committer?.date)||0);
   let filtered=runHistory.workflow_runs.filter(r=>r.event==='pull_request'&&r.head_branch===branch&&ms(r.created_at)>=ms(pr.created_at)&&ms(r.created_at)<=end);
   const core=filtered.filter(r=>r.name==='HH PR core release gate');
   if(core.length)filtered=core;
   else{
    filtered.sort((a,b)=>ms(a.created_at)-ms(b.created_at));
    filtered=filtered.filter((r,i,arr)=>arr.findIndex(x=>x.head_sha===r.head_sha)===i);
   }
   if(filtered.length>8)filtered=[...filtered.slice(0,2),...filtered.slice(-6)];
   const jobsByRun={};
   for(let i=0;i<filtered.length;i+=2){
    const pair=await Promise.all(filtered.slice(i,i+2).map(async r=>{
     try{
      const z=await gh(ROOT+'/actions/runs/'+r.id+'/jobs?per_page=100');
      return [r.id,Array.isArray(z.jobs)&&z.total_count<=100?z.jobs:[]];
     }catch(e){return [r.id,[]]}
    }));
    for(const [id,jobs] of pair)jobsByRun[String(id)]=jobs;
   }
   const fakeMerged=pr.merged_at||new Date().toISOString();
   const analysis=window.HHPrecommit?.analyze({pr:{...pr,merged_at:fakeMerged},commits,workflowRuns:runHistory,jobsByRun});
   if(!analysis)throw Error('Модуль разложения ещё не загружен');
   state.details.set(n,{analysis});
  }catch(e){state.details.set(n,{error:String(e?.message||e)})}
  draw();
 }
 function draw(){
  const root=state.target;if(!root)return;
  let html='<div class="phc-head"><div><h3>Сравнение трёх суточных когорт PR</h3>'+
   '<small>Все созданные PR, включая незакрытые · время Торонто</small></div>'+
   '<button type="button" data-refresh '+(state.busy?'disabled':'')+'>Перепроверить</button></div>';
  if(state.mode==='loading'){root.innerHTML=html+'<p>Загружаю проверенный исторический срез…</p>';return}
  if(state.mode==='error'){root.innerHTML=html+'<p class="phc-error">'+escaped(state.error)+'</p>';return}
  if(state.error)html+='<p class="phc-error">'+escaped(state.error)+'</p>';
  const rows=IDS.map(id=>state.windows.find(x=>x.id===id)).filter(Boolean).map(summarize);
  const b=rows[0],w=rows[1],cur=rows[2];
  html+='<p class="phc-note">Проверенный срез '+local(ms(state.at))+' (Торонто). Незакрытый PR — открытый <b>в конце указанных суток</b>, даже если позднее закрыт.</p>'+
   '<div class="phc-grid">'+rows.map(windowCard).join('')+'</div>';
  if(b&&w&&cur)html+='<p class="phc-highlight"><b>Самое сильное ухудшение: 27–28 октября.</b> Доля незакрытых PR: '+
    fmt(b.pct)+'% → '+fmt(w.pct)+'% (+'+fmt(w.pct-b.pct)+' п.п.). Среднее до merge: '+fmt(b.avg)+' → '+
    fmt(w.avg)+' мин (рост в '+fmt(w.avg/b.avg)+' раза). Последние сутки: незакрытых '+fmt(cur.pct)+
    '%, среднее до merge '+fmt(cur.avg)+' мин. Это статистика всего PR, не измеренное ожидание Runner.</p>';
  html+='<div class="phc-examples"><h4>Примеры длинных промежутков: первая CI → последний коммит</h4>'+
   '<p class="phc-note">Измеренные события из GitHub только для выбранных долгих PR. Между ними могли быть исправления, повторные CI и ожидания; это <b>не доказанные минуты простоя</b> и не среднее по всем PR.</p>'+
   IDS.map(id=>{
    const cohort=rows.find(x=>x.id===id),examples=representativeGaps[id];
    return '<div class="phc-example-group"><strong>'+escaped(cohort?.label||id)+'</strong>'+
     examples.map(x=>'<span><a href="https://github.com/andylitvinov-design/books/pull/'+x.pr+'" target="_blank" rel="noopener noreferrer">#'+x.pr+'</a> '+
      fmt(x.minutes)+' мин <button type="button" data-pr="'+x.pr+'">Этапы</button></span>').join('')+'</div>';
   }).join('')+'</div>';
  html+=analysisCard()+
   '<p class="phc-note">«Этапы» показывает исходные метки каждого PR: первую CI, очередь Runner, исполнение, промежутки после ошибок и изменения кода. Периоды без событий остаются неизвестными. Обновление выполняется вручную, без cron и платных API.</p>';
  root.innerHTML=html;
 }
 function mount(parent){
  const anchor=parent?.querySelector('.ph-composition');if(!anchor)return;
  if(state.target&&parent.contains(state.target)){draw();return}
  const el=document.createElement('section');el.className='phc-compare';
  el.addEventListener('click',ev=>{
   const b=ev.target?.closest?.('button[data-refresh],button[data-pr],button[data-close]');if(!b)return;
   if(b.hasAttribute('data-refresh')){void refresh();return}
   if(b.hasAttribute('data-close')){state.selected=null;draw();return}
   const n=Number(b.getAttribute('data-pr'));if(Number.isSafeInteger(n))void inspect(n);
  });
  state.target=el;anchor.insertAdjacentElement('afterend',el);draw();
  if(state.mode==='loading')void load();
 }
 window.HHCohortCompare={mount,summarize,check,rolling,inspect};
})();