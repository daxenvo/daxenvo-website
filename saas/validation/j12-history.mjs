// Manual, simulation-only campaign against the retained development fixtures.
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import postgres from 'postgres';
import {ledgerConnection} from '../src/lib/ai/connection.ts';

const origin='http://127.0.0.1:3137';
class CheckFailure extends Error {}
function check(value,stage){if(!value)throw new CheckFailure(stage);}
async function run(){
  const {a,b}=JSON.parse(process.env.J12_FIXTURES);
  const base=process.env.SUPABASE_URL;
  check(base==='https://mniconjzkvvvwqoxtzwu.supabase.co' && process.env.DAXENVO_AI_MODE==='simulation','configuration');
  const connection=ledgerConnection(process.env.DAXENVO_AI_DATABASE_URL,base,process.env.DAXENVO_AI_SESSION_POOLER_HOST);
  check(connection,'runtime');
  const db=postgres({...connection,max:1,prepare:false,connect_timeout:8,onnotice:()=>{}});
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH ?? '/usr/bin/google-chrome',args:['--no-sandbox']});
  const contexts=[],tokens=[];
  const auth={apikey:process.env.SUPABASE_PUBLISHABLE_KEY};
  async function login(f){
    const ctx=await browser.newContext({baseURL:origin});
    contexts.push(ctx);
    const res=await ctx.request.post('/auth/connexion',{headers:{origin},form:{email:f.email,password:f.password},maxRedirects:0});
    check(res.headers().location==='/espace','Next login');
    const granted=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:f.password})});
    check(granted.ok,'Auth');
    const token=await granted.json();
    tokens.push(token.access_token);
    check(token.user?.id===f.actor,'fixture identity');
    return {ctx,token:token.access_token,f};
  }
  function operation(){const id=randomUUID();console.log('Fixture operation',id);return id;}
  async function api(s,id,path='',method='GET',data){
    return s.ctx.request.fetch('/api/quote-requests/'+id+path,{method,headers:{origin,'x-daxenvo-company':s.f.company},data});
  }
  async function history(s){
    const res=await api(s,s.f.request,'/ai-analysis');check(res.ok(),'history');return (await res.json()).data;
  }
  async function analyze(s,id){
    const res=await api(s,s.f.request,'/ai-analysis','POST',{operation:id});check(res.ok(),'qualification');return res.json();
  }
  async function table(s,query,method='GET',body){
    return fetch(base+'/rest/v1/request_ai_qualifications?'+query,{method,headers:{...auth,Authorization:'Bearer '+s.token,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
  }
  let restore;
  try {
    const guest=await browser.newContext({baseURL:origin});
    try{
      const unauth=await guest.request.get('/api/quote-requests/'+a.request+'/ai-analysis');
      check(unauth.status()===401,'anonymous API read');
    }finally{await guest.close();}
    const A=await login(a),B=await login(b);
    check((await history(A)).length===0 && (await history(B)).length===0,'fixture baseline');
    const first=operation(),fallback=operation();
    check((await analyze(A,first)).result?.analysePar==='simulation','simulated result');
    check((await analyze(B,fallback)).result?.repli?.code==='invalid','J6 fallback');
    check((await analyze(A,first)).duplicate===true,'replay');
    const [row]=await history(A),[j6]=await history(B);
    check(row?.operation===first && row.revision===1 && row.created_by===a.actor && j6?.result.analysePar==='regles' && j6.operation===fallback,'persisted results');
    for(const [own,other] of [[A,B],[B,A]]){
      const res=await table(own,'select=operation&company_id=eq.'+other.f.company);
      check(res.ok() && (await res.json()).length===0,'RLS');
      check((await api(own,other.f.request,'/ai-analysis')).status()===404,'Next isolation');
    }
    for(const [method,body] of [['PATCH',{outcome:'invalid'}],['DELETE',undefined],['POST',{...row,request_id:a.request,company_id:a.company}]]){
      const res=await table(A,'operation=eq.'+first,method,body);
      check(res.status===403 && (await res.json()).code==='42501','client write denied');
    }
    const original=(await (await api(A,a.request)).json()).data;
    const changed=original.description==='Révision de validation J12-2'?'Projet de validation modifié':'Révision de validation J12-2';
    restore=async()=>{
      const live=await api(A,a.request);check(live.ok(),'restore read');
      const description=(await live.json()).data.description;
      if(description===original.description)return;
      check(description===changed,'unexpected fixture change');
      check((await api(A,a.request,'','PATCH',{description:original.description})).ok(),'restore fixture');
    };
    check((await api(A,a.request,'','PATCH',{description:changed})).ok(),'change source');
    const second=operation();await analyze(A,second);
    const rows=await history(A);
    check(rows.length===2 && rows[0].operation===second && rows[0].revision===2 && rows[1].operation===first,'revision order');
    const page=await A.ctx.newPage();
    await page.goto(origin+'/espace?vue=demandes&id='+a.request+'&onglet=qualification');
    await page.getByRole('heading',{name:'Simulation · Révision 2',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Simulation · Révision 1',exact:true}).waitFor();
    const bpage=await B.ctx.newPage();
    await bpage.setViewportSize({width:390,height:844});
    await bpage.goto(origin+'/espace?vue=demandes&id='+b.request+'&onglet=qualification');
    await bpage.getByRole('heading',{name:'Repli sur les règles J6 · Révision 1',exact:true}).waitFor();
    check(await bpage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile overflow');
    const stale=operation(),target=a.contentionRequests[0];
    const res=await api(A,target);check(res.ok(),'stale fixture');
    const {data:s}=await res.json();
    const hash=v=>createHash('sha256').update(v).digest('hex');
    const fingerprint=hash([s.description,s.project_type,s.city,String(s.budget),s.requested_timeline].map(hash).join(''));
    const scoped=fn=>db.begin(async tx=>{
      await tx.unsafe('set local role daxenvo_ai_gateway');
      await tx`select set_config('daxenvo.ai_company',${a.company},true),set_config('daxenvo.ai_actor',${a.actor},true)`;return fn(tx);
    });
    const [grant]=await scoped(tx=>tx`select daxenvo_private.ai_reserve_analysis(${stale},${target},${fingerprint},100) as v`);
    check(grant.v.model,'stale reservation');
    const prevRestore=restore;
    const marker='Validation J12-2 '+stale;
    restore=async()=>{try{
      const live=await api(A,target);check(live.ok(),'stale restore read');
      const d=(await live.json()).data.description;
      if(d!==s.description){check(d===marker,'unexpected stale fixture change');check((await api(A,target,'','PATCH',{description:s.description})).ok(),'stale restore');}
    }finally{await prevRestore();}};
    check((await api(A,target,'','PATCH',{description:marker})).ok(),'stale update');
    const [settled]=await scoped(tx=>tx`select daxenvo_private.ai_finish_analysis(${stale},${target},'completed',5,5,'{}'::jsonb) as v`);
    check(settled.v==='stale','obsolete result');
    const empty=await table(A,'select=operation&operation=eq.'+stale);
    check(empty.ok() && (await empty.json()).length===0,'obsolete revision absent');
    console.log('Next.js, persisted revisions, fallback, replay, RLS, UI and stale settlement verified');
  }finally{
    try{await restore?.();}finally{
      try{
        const cleanup=await Promise.allSettled(contexts.map(c=>c.request.post('/auth/deconnexion',{headers:{origin},form:{},maxRedirects:0})));
        const logout=await Promise.allSettled(tokens.map(t=>fetch(base+'/auth/v1/logout?scope=local',{method:'POST',headers:{...auth,Authorization:'Bearer '+t}})));
        check(cleanup.every(x=>x.status==='fulfilled' && x.value.status()<400) && logout.every(x=>x.status==='fulfilled' && (x.value.ok||x.value.status===401)),'session cleanup');
      }finally{await Promise.allSettled([browser.close(),db.end({timeout:2})]);}
    }
  }
}
run().catch(error=>{console.error('J12-2 campaign incomplete', error instanceof CheckFailure ? error.message : 'technical failure');process.exitCode=1;});
