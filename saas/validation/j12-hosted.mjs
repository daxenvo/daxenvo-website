// Run from saas after the build, with Next.js listening only on localhost.
// J12_FIXTURES is an Actions secret containing {a,b}, each with email, password,
// actor, company and request. A also has two distinct contentionRequests.
// The operator configures one project slot, output limit 1024 for A and 1 for B.
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {request} from "@playwright/test";
import postgres from "postgres";
import {ledgerConnection} from "../src/lib/ai/connection.ts";

const origin="http://127.0.0.1:3137";
const headers={origin};
const uuid=()=>randomUUID();
async function validate() {
  assert.equal(process.env.DAXENVO_AI_MODE,"simulation");
  const config=ledgerConnection(process.env.DAXENVO_AI_DATABASE_URL,process.env.SUPABASE_URL,process.env.DAXENVO_AI_SESSION_POOLER_HOST);
  assert.ok(config);
  const {a,b}=JSON.parse(process.env.J12_FIXTURES);
  const clients=[0,1].map(()=>postgres({...config,max:1,prepare:false,connect_timeout:8,onnotice:()=>{}}));
  const sessions=[];
  try {
    const peers=await Promise.all(clients.map(async db=>{
      const [peer]=await db`select pg_backend_pid() as pid, current_user as login, ssl,version from pg_stat_ssl where pid=pg_backend_pid()`;
      assert.equal(peer.login,"daxenvo_ai_runtime");assert.equal(peer.ssl,true);
      return peer;
    }));
    assert.notEqual(peers[0].pid,peers[1].pid);
    console.log("Backend TLS verified",peers.map(p=>({pid:p.pid,version:p.version})));
    for(const [fixture,expected] of [[a,"simulation"],[b,"regles"]]){
      const session=await request.newContext({baseURL:origin,extraHTTPHeaders:headers});sessions.push(session);
      const login=await session.post("/auth/connexion",{form:{email:fixture.email,password:fixture.password},maxRedirects:0});
      assert.equal(login.headers().location,"/espace");
      const operation=uuid();
      const res=await session.post("/api/quote-requests/"+fixture.request+"/ai-analysis",{data:{operation}});
      assert.equal(res.status(),200);const body=await res.json();
      assert.equal(body.operation,operation);assert.equal(body.result.analysePar,expected);
      assert.equal(body.state,expected==="regles"?"invalid":"completed");
      if(expected==="regles") assert.equal(body.result.repli.code,"invalid");
      console.log("Next.js verified",operation,body.state,expected);
    }
    const targets=a.contentionRequests;
    assert.equal(new Set([a.request,...targets]).size,3);
    assert.equal(targets.length,2);
    const hash=s=>createHash("sha256").update(s).digest("hex");
    const sources=await Promise.all(targets.map(async id=>{
      const res=await sessions[0].get("/api/quote-requests/"+id);assert.equal(res.status(),200);
      const {data:d}=await res.json();
      return hash([d.description,d.project_type,d.city,String(d.budget),d.requested_timeline].map(hash).join(""));
    }));
    const ops=[uuid(),uuid()];
    async function reserve(tx,i){
      await tx.unsafe("set local role daxenvo_ai_gateway");
      await tx.unsafe("set local statement_timeout='12s'");
      await tx`select set_config('daxenvo.ai_company',${a.company},true),set_config('daxenvo.ai_actor',${a.actor},true)`;
      const [row]=await tx`select daxenvo_private.ai_reserve_analysis(${ops[i]},${targets[i]},${sources[i]},100) as result`;
      return row.result;
    }
    let contender;
    try {
      await clients[0].begin(async tx=>{
        assert.ok((await reserve(tx,0)).model);
        contender=clients[1].begin(t=>reserve(t,1));
        void contender.catch(()=>{});
        for(let i=0;i<45;i++){
          const [row]=await tx`select pg_backend_pid()=any(pg_blocking_pids(${peers[1].pid}::int)) as blocked`;
          if(row.blocked){console.log("Observed lock",peers[0].pid,"blocking",peers[1].pid);return}
          await delay(100);
        }
        throw Error("LOCK_NOT_OBSERVED");
      });
      assert.equal(await contender,"QUOTA_LIMIT");
      console.log("Accepted",ops[0],"refused",ops[1]);
    } finally { if(contender) await Promise.allSettled([contender]); }
  } finally {
    try {for(const s of sessions){try {await s.post("/auth/deconnexion",{form:{},maxRedirects:0})} finally {await s.dispose()}}}
    finally {await Promise.all(clients.map(c=>c.end({timeout:2})))}
  }
}
validate().catch(()=>{console.error("Hosted J12 check failed; inspect the last completed stage and ledger.");process.exitCode=1});
