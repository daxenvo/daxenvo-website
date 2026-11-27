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
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
  for(const file of ['001_company_foundation','002_company_permissions','007_ai_usage_limits']){
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
