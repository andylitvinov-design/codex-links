'use strict';
/* HH_PR_PRECOMMIT_SLICES_V2: deterministic wall-clock partition, no false idle time. */
(()=>{
 if(window.HHPrecommit)return;
 const GH='https://github.com/andylitvinov-design/books';
 const CORE='HH PR core release gate';
 const labels={
  before_first:'До первой наблюдаемой CI',
  routing:'Маршрутизация workflow → job',
  queue:'Очередь GitHub Runner',
  execution:'Исполнение CI (объединённое время)',
  after_failure:'После ошибки CI → новое событие',
  after_cancel:'После отменённой CI → новое событие',
  after_success:'После зелёной CI → новое событие',
  incomplete_ci:'CI известна, но конец волны не подтверждён',
  no_evidence:'Нет меток для определения действия'
 };
 const when=x=>{const t=Date.parse(x||'');return Number.isFinite(t)?t:null};
 const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/i.test(x);
 const add=(times,t,min,max)=>{if(t!==null&&t>min&&t<max)times.add(t)};
 const boundedURL=x=>typeof x==='string'&&x.startsWith(GH+'/actions/runs/')&&/^https:\/\/github\.com\/andylitvinov-design\/books\/actions\/runs\/\d+(?:\/job\/\d+)?$/.test(x);
 const equals=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
 function analyze({pr,commits,workflowRuns,jobsByRun={}}){
  if(!pr||!Number.isSafeInteger(pr.number)||pr.number<=0||!sha(pr.head?.sha)||typeof pr.head?.ref!=='string')
   throw Error('Не подтверждён номер PR или HEAD');
  const created=when(pr.created_at),merged=when(pr.merged_at);
  if(created===null||merged===null||merged<created)throw Error('Неполная дата создания или merge');
  if(!Array.isArray(commits)||!commits.length||commits.length>=100)throw Error('История коммитов отсутствует или обрезана');
  const final=commits.at(-1);
  if(!sha(final?.sha)||!equals(final.sha,pr.head.sha))throw Error('Последний HEAD не совпадает с PR');
  const codeAt=when(final.commit?.committer?.date);
  if(codeAt===null||codeAt>merged)throw Error('Недостоверная дата последнего коммита');
  const end=Math.max(created,codeAt); // last commit may predate PR creation
  const lineage=new Set(commits.filter(c=>sha(c?.sha)).map(c=>c.sha.toLowerCase()));
  const raw=Array.isArray(workflowRuns?.workflow_runs)?workflowRuns.workflow_runs:[];
  const partial=!Array.isArray(workflowRuns?.workflow_runs)||!Number.isSafeInteger(workflowRuns.total_count)||
   workflowRuns.total_count>raw.length||raw.length>=100;
  let seen=raw.filter(r=>r.event==='pull_request'&&r.head_branch===pr.head.ref&&sha(r.head_sha)&&
    when(r.created_at)!==null&&when(r.created_at)>=created&&when(r.created_at)<=end);
  const hasCore=seen.some(r=>r.name===CORE);
  if(hasCore)seen=seen.filter(r=>r.name===CORE);
  else{
   // Legacy architecture: many workflow jobs launch concurrently for each HEAD.
   // Sample one earliest registered workflow per HEAD; never present as full CI coverage.
   seen.sort((a,b)=>when(a.created_at)-when(b.created_at));
   const seenHeads=new Set();
   seen=seen.filter(r=>{const head=r.head_sha.toLowerCase();if(seenHeads.has(head))return false;seenHeads.add(head);return true});
  }
  seen.sort((a,b)=>when(a.created_at)-when(b.created_at)||Number(a.id)-Number(b.id));
  const runs=seen.map(r=>{
   const association=Array.isArray(r.pull_requests)&&r.pull_requests.some(x=>x.number===pr.number)?
    'PR_LINK':lineage.has(r.head_sha.toLowerCase())?'COMMIT_SHA':'BRANCH_TIME_ONLY';
   const rawJobs=Array.isArray(jobsByRun[String(r.id)])?jobsByRun[String(r.id)]:[];
   const jobs=rawJobs.filter(j=>j.status==='completed'&&j.conclusion!=='skipped'&&
    when(j.created_at)!==null&&when(j.started_at)!==null&&when(j.completed_at)!==null&&
    when(j.created_at)<=when(j.started_at)&&when(j.started_at)<=when(j.completed_at)&&
    when(j.completed_at)<=merged&&when(j.created_at)>=created);
   const done=jobs.length?Math.max(...jobs.map(x=>when(x.completed_at))):null;
   return {id:r.id,head:r.head_sha,at:when(r.created_at),outcome:r.conclusion||r.status,
    url:boundedURL(r.html_url)?r.html_url:null,association,jobs,done};
  });
  const times=new Set([created,end]);for(const run of runs){
   add(times,run.at,created,end);
   for(const job of run.jobs)for(const name of ['created_at','started_at','completed_at'])
    add(times,when(job[name]),created,end);
  }
  // Commit times are markers, not evidence of continuously active development.
  const sourceEvents=commits.filter(c=>sha(c?.sha)&&when(c.commit?.committer?.date)!==null)
   .map(c=>({sha:c.sha,at:when(c.commit.committer.date),title:String(c.commit?.message||'').split('\n')[0].slice(0,130)}))
   .filter(x=>x.at>=created&&x.at<=end).sort((a,b)=>a.at-b.at);
  for(const c of sourceEvents)add(times,c.at,created,end);
  const points=[...times].sort((a,b)=>a-b),segments=[];
  for(let i=0;i<points.length-1;i++){
   const from=points[i],to=points[i+1];if(to<=from)continue;
   const mid=(from+to)/2,seenSoFar=runs.filter(r=>r.at<=mid),current=seenSoFar.at(-1);
   let category='no_evidence',detail='Промежуток без подтверждённых событий',evidence=null,quality='UNOBSERVED';
   if(!current){
    category='before_first';detail=partial?'До первого найденного CI; история GitHub неполная':'До первого наблюдаемого запуска CI';
    quality=partial?'PARTIAL':'RUN_REGISTRATION';
   }else{
    const active=seenSoFar.flatMap(r=>r.jobs.map(j=>({r,j})));
    const executing=active.find(x=>when(x.j.started_at)<=mid&&when(x.j.completed_at)>mid);
    const queued=active.find(x=>when(x.j.created_at)<=mid&&when(x.j.started_at)>mid);
    if(executing){category='execution';detail=executing.j.name;quality='JOB_TIMES';evidence=executing.r.url;}
    else if(queued){category='queue';detail=queued.j.name;quality='JOB_TIMES';evidence=queued.r.url;}
    else if(current.jobs.length&&current.at<=mid&&mid<Math.min(...current.jobs.map(j=>when(j.created_at)))){
     category='routing';detail='Workflow → первое зарегистрированное задание';quality='JOB_TIMES';evidence=current.url;
    }else if(current.done!==null&&current.done<=mid){
     category=current.outcome==='failure'?'after_failure':current.outcome==='cancelled'?'after_cancel':
      current.outcome==='success'?'after_success':'no_evidence';
     detail='Последняя измеренная CI завершилась; причины дальнейшего интервала неизвестны';
     quality='CI_OUTCOME+JOB_TIMES';evidence=current.url;
    }else{category='incomplete_ci';detail='У предыдущей CI нет полного завершения jobs';quality='PARTIAL';evidence=current.url;}
   }
   const sec=(to-from)/1000,prev=segments.at(-1);
   if(prev&&prev.category===category&&prev.detail===detail&&prev.evidence===evidence&&prev.quality===quality&&prev.to===from)
    {prev.to=to;prev.seconds+=sec}
   else segments.push({from,to,seconds:sec,category,label:labels[category],detail,quality,evidence});
  }
  const sums=Object.fromEntries(Object.keys(labels).map(k=>[k,0]));
  for(const s of segments)sums[s.category]+=s.seconds;
  const seconds=(end-created)/1000;
  if(Math.abs(Object.values(sums).reduce((a,b)=>a+b,0)-seconds)>.001)throw Error('Интервалы времени пересекаются или пропущены');
  return {schema:'HH_PR_PRECOMMIT_SLICES_V2',number:pr.number,head:pr.head.sha,
   from:created,finalCommitAt:codeAt,windowEnd:end,untilLastCommitSeconds:seconds,
   lastCommitPredatesPR:codeAt<created,historyPartial:partial||!hasCore,
   sampleScope:hasCore?'CORE_ONLY':'LEGACY_ONE_RUN_PER_HEAD',runs:runs.map(({jobs,...rest})=>({...rest,jobCount:jobs.length})),
   sourceEvents,segments,totalsSeconds:sums,labels,largest:[...segments].sort((a,b)=>b.seconds-a.seconds).slice(0,12),
   proofCoverage:{runCount:runs.length,withJobs:runs.filter(x=>x.jobs.length>0).length,
    exactHeads:runs.filter(x=>x.association!=='BRANCH_TIME_ONLY').length,branchOnly:runs.filter(x=>x.association==='BRANCH_TIME_ONLY').length},
   warning:'Отметка коммита не равна времени push. После ошибки/успеха отмечается календарный промежуток, но не доказанный простой.'};
 }
 window.HHPrecommit={analyze,labels};
})();
