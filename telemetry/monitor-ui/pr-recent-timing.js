'use strict';
/* HH_RECENT_PR_TIMELINE_V1: read-only GitHub timestamps, bounded on-demand requests. */
(()=>{
 if(window.HHRecentPR)return;
 const GH='https://api.github.com/repos/andylitvinov-design/books';
 const PROD='codex/public-book-library';
 const state={status:'idle',rows:[],at:null,error:null,selected:null,details:new Map(),loading:new Set()};
 let target=null;
 const t=x=>{const z=Date.parse(x||'');return Number.isFinite(z)?z:null};
 const diff=(a,b)=>a!==null&&b!==null&&b>=a?(b-a)/60000:null;
 const m=(a,b)=>diff(t(a),t(b));
 const n=x=>Number.isSafeInteger(x)&&x>0;
 const sha=x=>/^[a-f0-9]{40}$/i.test(x||'');
 const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,z=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[z]));
 const dur=x=>{if(x===null||!Number.isFinite(x)||x<0)return '—';const k=Math.round(x*60);return k>=3600?Math.floor(k/3600)+' ч '+Math.floor(k%3600/60)+' мин':k>=60?Math.floor(k/60)+' мин '+String(k%60).padStart(2,'0')+' с':k+' с'};
 const local=x=>x===null?'—':new Date(x).toLocaleString('ru-RU',{timeZone:'America/Toronto',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 const jobUrl=x=>typeof x==='string'&&/^https:\/\/github\.com\/andylitvinov-design\/books\/actions\/runs\/\d+\/job\/\d+$/.test(x);
 async function read(url){
  if(typeof url!=='string'||!url.startsWith(GH+'/'))throw Error('INVALID_GITHUB_API_PATH');
  const response=await fetch(url,{headers:{Accept:'application/vnd.github+json'}});
  if(!response.ok)throw Error(response.status===403||response.status===429?'GitHub API: ограничение запросов':'GitHub HTTP '+response.status);
  return response.json();
 }
 function normalize(pr){
  if(!n(pr?.number)||!sha(pr?.head?.sha)||!pr.merged_at||!pr.created_at||pr.base?.ref!==PROD||pr.base?.repo?.full_name!=='andylitvinov-design/books'||!/^[A-Za-z0-9._\/-]{1,160}$/.test(pr.head?.ref||''))return null;
  const elapsed=m(pr.created_at,pr.merged_at);
  if(elapsed===null)return null;
  return {number:pr.number,title:String(pr.title||'').slice(0,160),created_at:pr.created_at,
   merged_at:pr.merged_at,head_sha:pr.head.sha,head_branch:pr.head.ref,total:elapsed,ci:'pending',first:null,gateAt:null,gate:null,critical:null};
 }
 function analyzeChecks(pr,src){
  if(!src||!Array.isArray(src.check_runs)||src.total_count>100)return {...pr,ci:'partial'};
  const checks=src.check_runs.filter(x=>x.head_sha===pr.head_sha&&x.status==='completed'&&x.conclusion==='success'&&
   t(x.started_at)!==null&&t(x.completed_at)!==null&&t(x.started_at)<=t(x.completed_at)&&t(x.completed_at)<=t(pr.merged_at));
  const gate=checks.filter(x=>x.name==='hh-merge-check'&&jobUrl(x.html_url)).sort((a,b)=>t(b.completed_at)-t(a.completed_at))[0];
  const required=checks.filter(x=>['core-lint-types-build','hh-specialist'].includes(x.name)&&jobUrl(x.html_url)&&(!gate||t(x.completed_at)<=t(gate.completed_at)));
  const first=required.slice().sort((a,b)=>t(a.started_at)-t(b.started_at))[0];
  if(!gate||!first||t(first.started_at)<t(pr.created_at)||t(first.started_at)>t(gate.completed_at))return {...pr,ci:'partial'};
  const slow=required.slice().sort((a,b)=>m(b.started_at,b.completed_at)-m(a.started_at,a.completed_at))[0];
  return {...pr,ci:'verified',first:first.started_at,gateAt:gate.completed_at,
   gate:{id:gate.id,url:gate.html_url,completed_at:gate.completed_at},
   critical:slow?{name:slow.name,min:m(slow.started_at,slow.completed_at),url:slow.html_url}:null};
 }
 function fromJobs(pr,run,jobs,commits,runsData=null){
  if(run?.head_sha!==pr.head_sha||run?.name!=='HH PR core release gate'||!Array.isArray(jobs?.jobs)||
   jobs.total_count>100||!Array.isArray(commits)||commits.length>=100)throw Error('Неполная или чужая история HEAD');
  const a=t(pr.created_at),b=t(pr.merged_at),q=t(run.created_at),g=t(pr.gateAt);
  const valid=jobs.jobs.filter(x=>['core-lint-types-build','hh-specialist','hh-merge-check'].includes(x.name)&&
   x.status==='completed'&&x.conclusion==='success'&&t(x.created_at)!==null&&t(x.started_at)!==null&&t(x.completed_at)!==null&&
   t(x.created_at)<=t(x.started_at)&&t(x.started_at)<=t(x.completed_at)&&t(x.completed_at)<=b);
  const first=valid.filter(x=>x.name!=='hh-merge-check').sort((x,y)=>t(x.started_at)-t(y.started_at))[0];
  const gate=valid.find(x=>x.name==='hh-merge-check'&&x.id===pr.gate?.id);
  if(!first||!gate||q===null||q<a||q>b||t(first.created_at)<q||t(first.started_at)>g||t(gate.completed_at)!==g)throw Error('Нет последовательных меток Core CI');
  const phases=[
   {title:'До регистрации финального CI',begin:a,end:q,source:'Сюда входят изменения кода, ожидания и маршрутизация до финального HEAD'},
   {title:'Маршрутизация GitHub workflow',begin:q,end:t(first.created_at),source:'Workflow создан → первый требуемый job создан'},
   {title:'Очередь Runner',begin:t(first.created_at),end:t(first.started_at),source:'Job created_at → started_at'},
   {title:'Финальная волна Core / Specialist',begin:t(first.started_at),end:g,source:'Включает параллельные проверки и внутренние зависимости'},
   {title:'После зелёного Gate до merge',begin:g,end:b,source:'GitHub Merge Gate завершён → PR merged_at'}
  ];
  if(phases.some(x=>x.end<x.begin||x.begin===null||x.end===null)||Math.abs(phases.reduce((s,x)=>s+(x.end-x.begin)/60000,0)-pr.total)>.02)throw Error('Периоды не складываются в полный PR');
  // Count previous exact-SHA waves only when linked to this PR's commit history.
  // GitHub can paginate runs; counts from truncated results are NOT totals.
  const commitShas=new Set(commits.filter(x=>sha(x?.sha)).map(x=>x.sha.toLowerCase()));
  const matchedRuns=Array.isArray(runsData?.workflow_runs)?runsData.workflow_runs
   .filter(x=>x.head_branch===pr.head_branch&&sha(x.head_sha)&&commitShas.has(x.head_sha.toLowerCase())&&
    x.event==='pull_request'&&t(x.created_at)>=a&&t(x.created_at)<=b).sort((x,y)=>t(x.created_at)-t(y.created_at)):[];
  const runInventoryComplete=Array.isArray(runsData?.workflow_runs)&&
   Number.isSafeInteger(runsData?.total_count)&&runsData.total_count>0&&runsData.total_count<100&&
   matchedRuns.some(x=>x.id===run.id);
  // Even if branch history is deleted or rate limited, the independently
  // read exact final Core run remains one confirmed wave.
  if(!matchedRuns.length||!Array.isArray(runsData?.workflow_runs))
   matchedRuns.push({...run,name:'HH PR core release gate',head_sha:pr.head_sha});
  const coreWaves=matchedRuns.filter(x=>x.name==='HH PR core release gate');
  const waveStats={coverage:runInventoryComplete?'COMPLETE_BRANCH_SAMPLE':'PARTIAL_OR_UNAVAILABLE',
   observedWorkflows:matchedRuns.length,uniqueCoreHeads:new Set(coreWaves.map(x=>x.head_sha)).size,
   coreRuns:coreWaves.length,cancelled:matchedRuns.filter(x=>x.conclusion==='cancelled').length,
   failed:matchedRuns.filter(x=>x.conclusion==='failure').length,
   recent:coreWaves.slice(-12).map(x=>({sha:x.head_sha,at:x.created_at,conclusion:x.conclusion||x.status,
    url:/^https:\/\/github\.com\/andylitvinov-design\/books\/actions\/runs\/\d+$/.test(x.html_url||'')?x.html_url:null}))};
  return {phases,jobs:valid.map(x=>({name:x.name,queue:m(x.created_at,x.started_at),runtime:m(x.started_at,x.completed_at),
   created:x.created_at,started:x.started_at,completed:x.completed_at,url:'https://github.com/andylitvinov-design/books/actions/runs/'+run.id+'/job/'+x.id,
   steps:Array.isArray(x.steps)?x.steps.filter(step=>step.status==='completed'&&t(step.started_at)!==null&&
    t(step.completed_at)!==null&&t(step.completed_at)>=t(step.started_at)&&
    t(step.completed_at)<=t(x.completed_at)).map(step=>({name:String(step.name||'').slice(0,120),
    duration:m(step.started_at,step.completed_at),started:step.started_at,completed:step.completed_at,
    conclusion:step.conclusion})).sort((a,b)=>b.duration-a.duration).slice(0,5):[]})),
   commits:commits.filter(x=>sha(x?.sha)&&t(x.commit?.committer?.date)!==null).map(x=>({sha:x.sha,at:x.commit.committer.date,
    msg:String(x.commit.message||'').split('\n')[0].slice(0,100)})),
   runUrl:run.html_url,waveStats};
 }
 async function refresh(){
  if(state.status==='loading')return;
  state.status='loading';state.error=null;draw();
  try{
   const payload=await read(GH+'/pulls?state=closed&sort=updated&direction=desc&per_page=40');
   if(!Array.isArray(payload))throw Error('Некорректный список GitHub PR');
   const recent=payload.map(normalize).filter(Boolean).sort((a,b)=>t(b.merged_at)-t(a.merged_at)).slice(0,8);
   const rows=[];
   for(let i=0;i<recent.length;i+=2){
    const pair=await Promise.all(recent.slice(i,i+2).map(async p=>{
     try{return analyzeChecks(p,await read(GH+'/commits/'+p.head_sha+'/check-runs?per_page=100'))}
     catch(ex){return {...p,ci:'unavailable',readError:String(ex?.message||ex)}}}));
    rows.push(...pair);
   }
   state.rows=rows;state.at=new Date().toISOString();state.status='ready';
  }catch(ex){state.status='error';state.error=String(ex?.message||ex)}
  draw();
 }
 async function select(num){
  const row=state.rows.find(x=>x.number===num);
  if(!row)return;
  if(state.selected===num){state.selected=null;draw();return}
  state.selected=num;draw();
  if(state.details.has(num)||state.loading.has(num)||row.ci!=='verified')return;
  const rid=/\/actions\/runs\/(\d+)\/job\/\d+$/.exec(row.gate?.url||'')?.[1];
  if(!rid||!/^\d{8,16}$/.test(rid)){state.details.set(num,{error:'Нет точного workflow run ID'});draw();return}
  state.loading.add(num);draw();
  try{
   const [run,jobs,commits,runHistory]=await Promise.all([
    read(GH+'/actions/runs/'+rid),read(GH+'/actions/runs/'+rid+'/jobs?per_page=100'),
    read(GH+'/pulls/'+num+'/commits?per_page=100'),
    read(GH+'/actions/runs?branch='+encodeURIComponent(row.head_branch)+'&per_page=100').catch(()=>null)]);
   state.details.set(num,fromJobs(row,run,jobs,commits,runHistory));
  }catch(ex){state.details.set(num,{error:String(ex?.message||ex)})}
  state.loading.delete(num);draw();
 }
 function details(pr){
  if(pr.number!==state.selected)return '';
  if(state.loading.has(pr.number))return '<p class="phr-note">Читаю Core CI workflow, jobs и коммиты…</p>';
  const data=state.details.get(pr.number);
  if(!data)return '<p class="phr-note">Нет полной подтверждённой цепочки финального CI.</p>';
  if(data.error)return '<p class="phr-error">'+esc(data.error)+'. Непроверенные минуты не считаем нулём.</p>';
  return '<div class="phr-details"><h4>Точное разложение '+dur(pr.total)+'</h4>'+
   data.phases.map(p=>'<div class="phr-phase"><strong>'+esc(p.title)+'</strong><b>'+dur((p.end-p.begin)/60000)+'</b>'+
    '<small>'+local(p.begin)+' → '+local(p.end)+' · '+esc(p.source)+'</small></div>').join('')+
   '<h4>Какие проверки заняли время</h4>'+
   data.jobs.map(j=>'<div class="phr-job"><a href="'+esc(j.url)+'" target="_blank" rel="noopener noreferrer">'+esc(j.name)+'</a>'+
    '<span>Очередь '+dur(j.queue)+'</span><b>Runner '+dur(j.runtime)+'</b>'+
    '<small>'+local(t(j.created))+' → '+local(t(j.started))+' → '+local(t(j.completed))+'</small>'+
    (j.steps.length?'<details class="phr-steps"><summary>Шаги внутри '+esc(j.name)+' <span>⌄</span></summary>'+
      j.steps.map(step=>'<div><span>'+esc(step.name)+'</span><b>'+dur(step.duration)+'</b><small>'+
       local(t(step.started))+' → '+local(t(step.completed))+'</small></div>').join('')+'</details>':'')+'</div>').join('')+
   '<h4>Повторные волны CI для этого PR</h4>'+
   '<p class="phr-note">Подтверждено Core-волн: <b>'+data.waveStats.coreRuns+'</b> на <b>'+
    data.waveStats.uniqueCoreHeads+'</b> версиях HEAD. В наблюдаемых GitHub workflows: отменено '+
    data.waveStats.cancelled+', ошибок '+data.waveStats.failed+
    '. Охват: '+(data.waveStats.coverage==='COMPLETE_BRANCH_SAMPLE'?'полный ответ GitHub для ветки':'частичный / недоступен')+
    '. Отмена ещё не означает потраченные runner-минуты.</p>'+
   data.waveStats.recent.slice(-6).map(r=>'<div class="phr-wave">'+
    (r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+r.sha.slice(0,8)+'</a>':'<b>'+r.sha.slice(0,8)+'</b>')+
    '<span>'+esc(local(t(r.at)))+'</span><small>'+esc(r.conclusion)+'</small></div>').join('')+
   '<h4>Изменения кода: '+data.commits.length+' коммитов</h4>'+
   data.commits.slice(-8).map(j=>'<div class="phr-commit"><a href="https://github.com/andylitvinov-design/books/commit/'+j.sha+'" target="_blank" rel="noopener noreferrer">'+j.sha.slice(0,8)+'</a>'+
    '<span>'+esc(local(t(j.at)))+'</span><small>'+esc(j.msg)+'</small></div>').join('')+
   '<p class="phr-note">Минуты между коммитами не равны бездействию. Исполнение Core и Specialist может идти параллельно; их длительности нельзя складывать. Шаг Specialist может включать ожидание и опрос зависимых GitHub workflows, а не только вычисления.</p></div>';
 }
 function draw(){
  if(!target)return;
  let content='<div class="phr-head"><div><h3>Последние PR: где проходит время</h3>'+
   '<small>Актуальные GitHub PR и точные проверки · '+(state.at?esc(local(t(state.at))):'данные загружаются')+' Торонто</small></div>'+
   '<button type="button" data-refresh'+(state.status==='loading'?' disabled':'')+'>Обновить</button></div>';
  if(state.status==='loading'||state.status==='idle')content+='<p class="phr-note">Собираю последние PR и GitHub checks…</p>';
  else if(state.status==='error')content+='<p class="phr-error">'+esc(state.error)+'</p>';
  else{
   const rows=state.rows,values=rows.map(x=>x.total),avg=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
   content+='<p class="phr-note">Последние <b>'+rows.length+' смерженных production PR</b> (отдельная выборка, не все PR за выбранные часы). Среднее: <b>'+dur(avg)+'</b>. Отсортировано по самым долгим.</p>';
   for(const pr of rows.slice().sort((a,b)=>b.total-a.total)){
    const pre=pr.first?m(pr.created_at,pr.first):null,ci=pr.first&&pr.gateAt?m(pr.first,pr.gateAt):null,post=pr.gateAt?m(pr.gateAt,pr.merged_at):null;
    const complete=pr.ci==='verified'&&pre!==null&&ci!==null&&post!==null&&Math.abs(pre+ci+post-pr.total)<.02;
    content+='<div class="phr-pr"><div class="phr-pr-title"><a href="https://github.com/andylitvinov-design/books/pull/'+pr.number+'" target="_blank" rel="noopener noreferrer">#'+pr.number+'</a>'+
     '<strong>'+dur(pr.total)+'</strong></div><p>'+esc(pr.title)+'</p>'+
     (complete?'<div class="phr-splits"><span>До Runner: <b>'+dur(pre)+'</b></span><span>Проверки: <b>'+dur(ci)+'</b></span><span>До merge: <b>'+dur(post)+'</b></span></div>'+
      '<p class="phr-critical">Самая длительная требуемая проверка: <b>'+esc(pr.critical?.name||'—')+'</b> '+dur(pr.critical?.min??null)+'</p>':
      '<p class="phr-note">Нет полных меток финального HEAD. Отсутствие данных не равно нулю.</p>')+
     '<button type="button" data-pr="'+pr.number+'">'+(state.selected===pr.number?'Свернуть':'Где и когда — детали')+'</button>'+details(pr)+'</div>';
   }
  }
  content+='<p class="phr-note">Проверка при открытии и по нажатию, без cron и платных API. Предварительные интервалы могут включать доработки и ожидания; детальный разбор их не смешивает с очередью Runner.</p>';
  target.innerHTML=content;
 }
 function mount(host){
  if(!host)return;
  const anchor=host.querySelector('.ph-composition');
  if(!anchor)return;
  target=document.createElement('section');target.className='ph-recent-live';
  target.addEventListener('click',ev=>{
   const btn=ev.target?.closest?.('button[data-pr],button[data-refresh]');if(!btn)return;
   if(btn.hasAttribute('data-refresh')){void refresh();return}
   const num=Number(btn.getAttribute('data-pr'));if(n(num))void select(num);
  });
  anchor.insertAdjacentElement('afterend',target);
  draw();
  if(state.status==='idle')void refresh();
 }
 window.HHRecentPR={mount,normalize,analyzeChecks,fromJobs};
})();
