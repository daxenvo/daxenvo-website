import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
// Native mode requires a fresh disposable localhost cluster. Roles are cluster-wide.
const native = process.env.J12_TEST_PG_PORT ? await import('postgres') : null;
const options={host:'127.0.0.1',port:Number(process.env.J12_TEST_PG_PORT),database:'postgres',
  username:process.env.J12_TEST_PG_USER,password:process.env.J12_TEST_PG_PASSWORD,max:1,onnotice:()=>{}};
const connect=()=>native.default(options);
const sql=native ? connect() : null;
const db=sql ? {exec:q=>sql.unsafe(q),query:async(q,params=[])=>({rows:[...await sql.unsafe(q,params)]}),close:()=>sql.end()} : new PGlite();
const company=randomUUID(), other=randomUUID(), actor=randomUUID(), target=randomUUID();
let source;
before(async () => {
  await db.exec(`create schema daxenvo_private; create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.actor',true),'')::uuid$$;`);
  for(const file of ['001_company_foundation','002_company_permissions','007_ai_usage_limits','008_ai_qualification_history']){
    await db.exec(await readFile(new URL('../migrations/'+file+'.sql',import.meta.url),'utf8'));
  }
  await db.query('insert into auth.users values ($1)',[actor]);
  await db.query("insert into companies(id,name) values ($1,'Tenant A'),($2,'Tenant B')",[company,other]);
  await db.query("insert into company_memberships values ($1,$2,'member')",[company,actor]);
  const prospect=randomUUID();
  await db.query("insert into prospects(id,company_id,name,sector,city) values ($1,$2,'Test','Test','Test')",[prospect,company]);
  await db.query("insert into quote_requests(id,company_id,prospect_id,title,description) values ($1,$2,$3,'Test','Projet fictif de rénovation')",[target,company,prospect]);
  await db.exec('insert into daxenvo_private.ai_project values(true,10000,10000,2)');
  await db.query("insert into daxenvo_private.ai_policy values ($1,'offline',5,5,1,2,1000,40,5000,5000,5000,5000,2,3)",[company]);
  source=(await db.query('select daxenvo_private.ai_source($1) as h',[target])).rows[0].h;
});
beforeEach(()=>db.exec('begin')); afterEach(()=>db.exec('rollback')); after(()=>db.close());
async function gateway(tenant=company,who=actor){
  await db.exec('set local role daxenvo_ai_gateway');
  await db.query("select set_config('daxenvo.ai_company',$1,true),set_config('daxenvo.ai_actor',$2,true)",[tenant,who]);
}
async function reserve(op=randomUUID(), size=100){
  return (await db.query('select daxenvo_private.ai_reserve($1,$2,$3,$4) as v',[op,target,source,size])).rows[0].v;
}
async function finish(op,state,input,output){
  return (await db.query('select daxenvo_private.ai_finish($1,$2,$3,$4,$5) as v',[op,target,state,input,output])).rows[0].v;
}
test('private access, RLS membership and tenant checks',async()=>{
  assert.equal((await db.query("select has_function_privilege('authenticated','daxenvo_private.ai_reserve(uuid,uuid,text,integer)','execute') ok")).rows[0].ok,false);
  await gateway(other); assert.equal(await reserve(),'NOT_FOUND');
  await gateway(company,randomUUID()); assert.equal(await reserve(),'NOT_FOUND');
});
test('parallel submissions, duplicate replay and actual charge',async()=>{
  await gateway();const op=randomUUID();
  const [first,second]=await Promise.all([reserve(op),reserve()]);
  assert.equal(first.model,'offline'); assert.equal(second,'CONFLICT');
  assert.deepEqual(await reserve(op),{duplicate:'reserved'});
  assert.equal(await finish(op,'completed',23,15),'completed');
  assert.deepEqual(await reserve(op),{duplicate:'completed'});
  await db.exec('reset role');
  assert.deepEqual((await db.query('select charge::int,reserved_cost::int from daxenvo_private.ai_attempt')).rows,[{charge:91,reserved_cost:320}]);
});
for(const [label,statement,expected] of [
  ['project budget','update daxenvo_private.ai_project set monthly_budget=319','BUDGET_LIMIT'],
  ['tenant budget','update daxenvo_private.ai_policy set daily_budget=319','BUDGET_LIMIT'],
  ['token ceiling','update daxenvo_private.ai_policy set daily_tokens=139','QUOTA_LIMIT'],
  ['input ceiling','update daxenvo_private.ai_policy set input_limit=99','INPUT_LIMIT'],
  ['missing policy','delete from daxenvo_private.ai_policy','NOT_CONFIGURED'],
])test(label,async()=>{await db.exec(statement);await gateway();assert.equal(await reserve(),expected)});
test('timeout retains maximum liability and blocks redispatch',async()=>{
  await gateway();const op=randomUUID();await reserve(op);
  assert.equal(await finish(op,'timeout',null,null),'timeout');assert.equal(await reserve(),'CONFLICT');
  await db.exec('reset role');assert.equal((await db.query('select charge::int from daxenvo_private.ai_attempt')).rows[0].charge,320);
});
test('bounded retries, stale source and retained consumption',async()=>{
  await gateway();const op=randomUUID();await reserve(op);await finish(op,'invalid',20,10);
  const next=randomUUID();assert.equal((await reserve(next)).model,'offline');
  await db.exec("reset role; update quote_requests set description='description modifiée'");
  await gateway();assert.equal(await finish(next,'completed',30,10),'stale');assert.equal(await reserve(),'SOURCE_CHANGED');
});
test('attempt and per-user ceilings before dispatch',async()=>{
  await db.exec('update daxenvo_private.ai_policy set user_daily=1');
  await gateway();const op=randomUUID();await reserve(op);await finish(op,'invalid',1,1);
  assert.equal(await reserve(),'QUOTA_LIMIT');
  await db.exec('reset role; update daxenvo_private.ai_policy set user_daily=5,attempts=1');await gateway();assert.equal(await reserve(),'ATTEMPT_LIMIT');
});

test('two independent PostgreSQL sessions compete for the final project slot',{skip:!native},async()=>{
  // This fixture must be visible to both new sessions. The surrounding test transaction is empty.
  const second=randomUUID();
  const clients=[connect(),connect()];
  let ready=0, release;
  const barrier=new Promise(resolve=>{release=resolve});
  try {
    await clients[0].unsafe('update daxenvo_private.ai_project set simultaneous=1');
    await clients[0].unsafe("insert into quote_requests(id,company_id,prospect_id,title,description) select $1,company_id,prospect_id,title,description from quote_requests where id=$2",[second,target]);
    const result=await Promise.all(clients.map((client,i)=>client.begin(async tx=>{
      const [{pid}]=await tx.unsafe('select pg_backend_pid() as pid');
      await tx.unsafe('set local role daxenvo_ai_gateway');
      await tx.unsafe("select set_config('daxenvo.ai_company',$1,true),set_config('daxenvo.ai_actor',$2,true)",[company,actor]);
      if(++ready===2)release(); await barrier;
      const [{v}]=await tx.unsafe('select daxenvo_private.ai_reserve($1,$2,$3,100) as v',[randomUUID(),i?second:target,source]);
      return {pid,v};
    })));
    assert.notEqual(result[0].pid,result[1].pid);
    assert.equal(result.filter(r=>r.v==='QUOTA_LIMIT').length,1);
    assert.equal(result.filter(r=>r.v.model==='offline').length,1);
    assert.equal((await db.query('select count(*)::int as n from daxenvo_private.ai_attempt')).rows[0].n,1);
  } finally {await Promise.all(clients.map(c=>c.end()))}
});

test('J12-2 immutable simulation and fallback revisions, replay, stale source and tenant reads',async()=>{
  const result={priorite:'moyenne',motif:'Simulation',actionRecommandee:'Vérifier',informationsManquantes:[],requiresHumanReview:true};
  const reserveAnalysis=async(op,h=source)=>(await db.query('select daxenvo_private.ai_reserve_analysis($1,$2,$3,100) v',[op,target,h])).rows[0].v;
  const settle=async(op,state)=>(await db.query('select daxenvo_private.ai_finish_analysis($1,$2,$3,5,5,$4::text::jsonb) v',
    [op,target,state,JSON.stringify({...result,analysePar:state==='completed'?'simulation':'regles'})])).rows[0].v;
  const otherOwner=randomUUID();
  await db.query('insert into auth.users values ($1)',[otherOwner]);
  await db.query("insert into company_memberships values ($1,$2,'owner')",[other,otherOwner]);
  await gateway(other,otherOwner);
  assert.equal(await reserveAnalysis(randomUUID()),'NOT_FOUND');
  await gateway();
  const a=randomUUID(),b=randomUUID(),c=randomUUID();
  assert.equal((await reserveAnalysis(a)).model,'offline');
  assert.equal(await reserveAnalysis(b),'CONFLICT');
  assert.equal(await settle(a,'invalid'),'invalid');
  assert.equal((await reserveAnalysis(b)).model,'offline');
  assert.equal(await settle(b,'completed'),'completed');
  assert.equal(await settle(b,'completed'),'completed');
  await db.exec("reset role; update quote_requests set description='second projet'");
  const h=(await db.query('select daxenvo_private.ai_source($1) h',[target])).rows[0].h;
  await gateway(); assert.equal((await reserveAnalysis(c,h)).model,'offline');
  await db.exec("reset role; update quote_requests set description='troisième projet'");
  await gateway(); assert.equal(await settle(c,'completed'),'stale');
  await db.exec('reset role');
  assert.equal((await db.query("select has_table_privilege('authenticated','public.request_ai_qualifications','insert') or has_table_privilege('authenticated','public.request_ai_qualifications','update') or has_table_privilege('authenticated','public.request_ai_qualifications','delete') v")).rows[0].v,false);
  await db.query("select set_config('request.actor',$1,true)",[actor]);
  await db.exec('set local role authenticated');
  const history=await db.query("select revision,outcome,model,prompt_version from request_ai_qualifications order by revision");
  assert.deepEqual(history.rows.map(r=>[r.revision,r.outcome,r.model,r.prompt_version]),[[1,'invalid','offline','qualification-signals-v2'],[2,'completed','offline','qualification-signals-v2']]);
  await db.query("select set_config('request.actor',$1,true)",[otherOwner]);
  assert.equal((await db.query('select * from request_ai_qualifications')).rows.length,0);
});

test('J12-2 settlement waits for a concurrent source update and records no stale revision', {skip:!native}, async()=>{
  const writer=connect(), analyzer=connect(), operation=randomUUID();
  const scope=async tx=>{
    await tx.unsafe('set local role daxenvo_ai_gateway');
    await tx.unsafe("select set_config('daxenvo.ai_company',$1,true),set_config('daxenvo.ai_actor',$2,true)",[company,actor]);
  };
  let pending;
  try {
    await analyzer.begin(async tx=>{
      await scope(tx);
      const [row]=await tx.unsafe('select daxenvo_private.ai_reserve_analysis($1,$2,$3,100) as grant',[operation,target,source]);
      assert.equal(row.grant.model,'offline');
    });
    const [{pid}]=await analyzer.unsafe('select pg_backend_pid() pid');
    await writer.begin(async tx=>{
      const [{blocker}]=await tx.unsafe('select pg_backend_pid() blocker');
      await tx.unsafe("update quote_requests set description='Projet modifié en parallèle' where id=$1",[target]);
      pending=analyzer.begin(async settlement=>{
        await scope(settlement);
        await settlement.unsafe("set local statement_timeout='8s'");
        return settlement.unsafe("select daxenvo_private.ai_finish_analysis($1,$2,'completed',5,5,'{}') as state",[operation,target]);
      });
      // Start the lazy transaction and keep any rejection handled until awaited.
      pending=Promise.resolve(pending);
      pending.catch(()=>{});
      let blocked=false;
      for(let poll=0;poll<100 && !blocked;poll++){
        blocked=(await db.query('select $1::int=any(pg_blocking_pids($2)) as blocked',[blocker,pid])).rows[0].blocked;
        if(!blocked) await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(blocked,true,'settlement must actually wait for the editor');
    });
    assert.equal((await pending)[0].state,'stale');
    assert.equal((await db.query('select count(*)::int n from request_ai_qualifications where operation=$1',[operation])).rows[0].n,0);
    assert.equal((await db.query('select state from daxenvo_private.ai_attempt where operation=$1',[operation])).rows[0].state,'stale');
  } finally {
    await Promise.allSettled([pending]);
    await Promise.all([writer.end(),analyzer.end()]);
  }
});
