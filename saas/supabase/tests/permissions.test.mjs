import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createHash, createHmac, randomUUID } from "node:crypto";
const db = new PGlite({extensions: {pgcrypto}});
const sqlFile = (path) => readFile(new URL(path, import.meta.url), "utf8");
const a = "20000000-0000-4000-8000-000000000001";
const b = "20000000-0000-4000-8000-000000000002";
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";
const outsider = "10000000-0000-4000-8000-000000000003";

before(async () => {
  // Seule l'identité Auth est simulée. PostgreSQL applique privilèges, RLS et contraintes.
  await db.exec(`
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create role anon;
    create role service_role bypassrls;
    alter default privileges in schema public grant execute on functions to service_role;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
  `);
  for (const file of [
    "001_company_foundation.sql",
    "002_company_permissions.sql",
    "003_request_qualifications.sql",
  ]) {
    await db.exec(await sqlFile("../migrations/" + file));
  }
  // Hosted Supabase reserves GRANT on auth to its managed schema owner.
  await db.exec("revoke usage on schema auth from daxenvo_qualification_writer");
  await db.exec(await sqlFile("../migrations/003b_qualification_writer_identity.sql"));
  await db.exec(await sqlFile("../migrations/003c_qualification_source_conflict.sql"));
  await db.exec(await sqlFile("../migrations/004_followup_automation.sql"));
  await db.exec(await sqlFile("../migrations/005_appointment_booking.sql"));
  await db.exec(await sqlFile("../migrations/006_client_dashboard.sql"));
  await db.exec(await sqlFile("./tenant-isolation.sql"));
  await db.query("insert into auth.users(id) values ($1), ($2), ($3)", [
    alice,
    bob,
    outsider,
  ]);
  await db.query(
    "insert into companies(id,name) values ($1,'Société A'), ($2,'Société B')",
    [a, b],
  );
  await db.query(
    `insert into company_memberships values
    ($1,$3,'member'), ($2,$3,'owner'), ($1,$4,'admin')`,
    [a, b, alice, bob],
  );
  for (const company of [a, b]) {
    const {
      rows: [p],
    } = await db.query(
      "insert into prospects(company_id,name,sector,city) values ($1,'Client fictif','Test','Nantes') returning id",
      [company],
    );
    const {
      rows: [r],
    } = await db.query(
      "insert into quote_requests(company_id,prospect_id,title,description) values ($1,$2,'Devis','Projet fictif') returning id",
      [company, p.id],
    );
    await db.query(
      "insert into followups(company_id,request_id,title,due_date) values ($1,$2,'Rappel',current_date)",
      [company, r.id],
    );
    await db.query(
      "insert into appointments(company_id,request_id,title,starts_at,duration_minutes) values ($1,$2,'Visite',now(),30)",
      [company, r.id],
    );
  }
});
beforeEach(() => db.exec("begin"));
afterEach(() => db.exec("rollback"));
after(() => db.close());

async function signIn(user) {
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: user }),
  ]);
}
const tables = [
  ["prospects", "name"],
  ["quote_requests", "title"],
  ["followups", "title"],
  ["appointments", "title"],
];
for (const [table, column] of tables) {
  test(table + " — locataire immuable même avec deux adhésions", async () => {
    await signIn(alice);
    assert.equal((await db.query(`select id from ${table}`)).rows.length, 2);
    await assert.rejects(
      db.query(`update ${table} set company_id=$1 where company_id=$2`, [b, a]),
      { code: "42501" },
    );
  });
  test(table + " — isolation des lectures et modifications", async () => {
    await signIn(bob);
    assert.deepEqual((await db.query(`select company_id from ${table}`)).rows, [
      { company_id: a },
    ]);
    assert.equal(
      (
        await db.query(
          `update ${table} set ${column}='Modification' where company_id=$1`,
          [b],
        )
      ).affectedRows,
      0,
    );
    assert.equal(
      (await db.query(`delete from ${table} where company_id=$1`, [b]))
        .affectedRows,
      0,
    );
  });
  test(table + " — le membre peut modifier mais pas supprimer", async () => {
    await signIn(alice);
    assert.equal(
      (
        await db.query(
          `update ${table} set ${column}='Modification' where company_id=$1`,
          [a],
        )
      ).affectedRows,
      1,
    );
    assert.equal(
      (await db.query(`delete from ${table} where company_id=$1`, [a]))
        .affectedRows,
      0,
    );
  });
}
for (const [role, user, company, rename] of [
  ["owner", alice, b, 1],
  ["admin", bob, a, 0],
  ["member", alice, a, 0],
]) {
  test(role + " — renommer l’entreprise et supprimer une relance", async () => {
    await signIn(user);
    assert.equal(
      (
        await db.query("update companies set name='Nouveau nom' where id=$1", [
          company,
        ])
      ).affectedRows,
      rename,
    );
    assert.equal(
      (await db.query("delete from followups where company_id=$1", [company]))
        .affectedRows,
      role === "member" ? 0 : 1,
    );
  });
}
test("Utilisateur sans adhésion — aucune donnée accessible", async () => {
  await signIn(outsider);
  for (const table of [
    "companies",
    "company_memberships",
    ...tables.map(([name]) => name),
  ]) {
    assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
  }
});

test("Échéance civile et instant du rendez-vous conservés après un changement de fuseau SQL", async () => {
  await signIn(alice);
  await db.exec("set local time zone 'Europe/Paris'");
  await db.query("update followups set due_date = $1 where company_id = $2", ["2027-10-31", a]);
  await db.query("update appointments set starts_at = $1 where company_id = $2", ["2027-10-31T02:30:00.123456+02:00", a]);
  await db.exec("set local time zone 'America/New_York'");
  const result = await db.query(
    `select f.due_date::text as day,
            to_char(ap.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as instant
       from followups f join appointments ap using (company_id, request_id)
      where f.company_id = $1`,
    [a],
  );
  assert.deepEqual(result.rows, [{ day: "2027-10-31", instant: "2027-10-31 00:30:00.123456" }]);
});

const testWriter = "ab".repeat(32);
const ruleResult = {
  version: "j6-regles-v1", priorite: "a_preciser", motif: "Calendrier à préciser",
  actionRecommandee: "Demander le calendrier", informationsManquantes: ["budget"],
  signaux: [], requiresHumanReview: true, analysePar: "regles", fournisseur: null,
  repli: { code: "IA_NON_CONFIGUREE" },
};
async function qualificationFixture() {
  await db.query("insert into daxenvo_private.qualification_writer(digest) values (sha256(convert_to($1,'UTF8')))", [testWriter]);
  const { rows: [row] } = await db.query(`select id, jsonb_build_object('description',description,
    'city',city,'project_type',project_type,'requested_timeline',requested_timeline,'budget',budget) as source
    from quote_requests where company_id=$1`, [b]);
  await signIn(alice);
  return {
    row,
    write: (overrides = {}) => {
      const args = { company: b, id: row.id, source: row.source, result: ruleResult, writer: testWriter, ...overrides };
      const hash = v => createHash("sha256").update(String(v)).digest("hex");
      const source = args.source;
      const fingerprint = hash([source.description, source.project_type, source.city,
        source.budget, source.requested_timeline].map(hash).join(""));
      const msg = JSON.stringify({purpose:"daxenvo.qualification.v1",actor:alice,
        company:args.company, request:args.id, nonce:args.nonce ?? randomUUID(),
        expires:args.expires ?? Math.floor(Date.now()/1000)+45,source:fingerprint,result:args.result});
      const key = createHash("sha256").update(args.writer).digest();
      return db.query("select * from record_request_qualification($1,$2)", [
        args.tamper ? msg.replace("Calendrier à préciser","Falsifié") : msg,
        createHmac("sha256", key).update(msg).digest("hex")]);
    },
  };
}

test("Historique successif, auteur Auth et isolation RLS", async () => {
  const { write } = await qualificationFixture();
  const first = (await write()).rows[0];
  const next = (await write()).rows[0];
  assert.equal(first.created_by, alice);
  assert.equal(next.revision, 2);
  assert.notEqual(first.id, next.id);
  assert.deepEqual((await db.query("select revision from request_qualifications order by revision")).rows, [{revision:1},{revision:2}]);
  await signIn(bob);
  assert.deepEqual((await db.query("select * from request_qualifications")).rows, []);
});
for (const [label, command] of [
  ["INSERT direct", "insert into request_qualifications default values"],
  ["UPDATE historique", "update request_qualifications set request_id=gen_random_uuid(), company_id=gen_random_uuid()"],
  ["DELETE historique", "delete from request_qualifications"],
  ["accès au condensat privé", "select * from daxenvo_private.qualification_writer"],
]) {
  test("Data API authenticated refuse " + label, async () => {
    const {write} = await qualificationFixture();
    await write();
    await assert.rejects(db.query(command), {code:"42501"});
  });
}
for (const [label, changes, code] of [
  ["secret incorrect",{writer:"00".repeat(32)},"42501"],
  ["signature altérée",{tamper:true},"42501"],
  ["autorisation expirée",{expires:1},"42501"],
  ["source modifiée",{source:{}},"PT409"],
  ["entreprise incohérente",{company:a},"P0002"],
  ["provenance falsifiée",{result:{...ruleResult,analysePar:"ia"}},"23514"],
]) {
  test("Persistance SQL refuse " + label, async () => {
    const {write} = await qualificationFixture();
    await assert.rejects(write(changes), {code});
  });
}
test("Identité sans adhésion refusée même avec le secret serveur", async () => {
  const {write} = await qualificationFixture();
  await signIn(bob);
  await assert.rejects(write(), {code:"42501"});
});

test("Une opération signée ne peut enregistrer deux révisions", async () => {
  const {write} = await qualificationFixture();
  const nonce = randomUUID();
  await write({nonce});
  await assert.rejects(write({nonce}), {code:"23505"});
});

test("Le rôle de persistance utilise le JWT sans accès au schéma Auth géré", async () => {
  const privileges = await db.query("select has_schema_privilege('daxenvo_qualification_writer','auth','usage') as usage");
  assert.equal(privileges.rows[0].usage, false);
  const {write} = await qualificationFixture();
  assert.equal((await write()).rows[0].created_by, alice);
});

test("Une modification après lecture refuse le résultat signé sans ajouter de révision", async () => {
  const {row, write} = await qualificationFixture();
  await write();
  await db.query("update quote_requests set description = $1 where id = $2", ["Description modifiée",row.id]);
  await db.exec("savepoint stale_write");
  await assert.rejects(write(), {code: "PT409", message: "SOURCE_CHANGED"});
  await db.exec("rollback to savepoint stale_write");
  const history = await db.query("select revision from request_qualifications where request_id = $1", [row.id]);
  assert.deepEqual(history.rows, [{revision: 1}]);
});

async function automationFixture() {
  const {rows:[request]}=await db.query("select * from quote_requests where company_id=$1",[a]);
  const id=request.id;
  const event=(kind,value=null,key=randomUUID())=>db.query(
    "select public.followup_automation_event($1,$2,$3,$4,$5)",[a,id,key,kind,value]);
  const configure=(delay=12,max=2)=>db.query(
    "select public.configure_followup_automation($1,$2,1,$3,1)",[a,delay,max]);
  const status=async()=> (await db.query(
    "select public.followup_automation_status($1,$2) as snapshot",[a,id])).rows[0].snapshot;
  await signIn(bob);
  await db.query("update followups set done=true where company_id=$1",[a]);
  await configure();
  await event("preference","email");
  return {id,event,configure,status};
}
test("J9 — délai, échéance, préparation unique et accusé réservé au fournisseur",async()=>{
  const {id,status,configure}=await automationFixture();
  const first=await status();
  assert.equal(first.job.state,"scheduled");
  await configure(24);
  assert.equal(Date.parse((await status()).job.due_at)-Date.parse(first.job.due_at),12*3600000);
  await db.exec("reset role");
  await db.query("update quote_requests set created_at=now()-interval '2 days' where id=$1",[id]);
  await db.query("update daxenvo_private.followup_job set due_at=now() where request_id=$1",[id]);
  const tick=()=>db.query("select daxenvo_private.run_followups($1) as n",[a]);
  assert.equal((await tick()).rows[0].n,1);
  assert.equal((await tick()).rows[0].n,0);
  const prepared=await status();
  assert.equal(prepared.job.state,"prepared");
  assert.equal(prepared.job.sent_count,0);
  await configure(24,1);
  const ack=()=>db.query("select daxenvo_private.confirm_followup_delivery($1,$2,$3,'fixture-receipt')",[a,id,prepared.history[0].id]);
  await ack(); await ack();
  const final=await status();
  assert.equal(final.job.sent_count,1);
  assert.equal(final.job.reason,"limit");
  assert.equal(final.history.filter(h=>h.state==="sent").length,1);
});
test("J9 — réponses, suspension, reprise et événements idempotents",async()=>{
  const {event,status}=await automationFixture();
  for(const kind of ["interested","information","appointment","human","pause"]){
    await event(kind);
    assert.equal((await status()).job.state,"cancelled");
    await event("resume");
    assert.equal((await status()).job.state,"scheduled");
  }
  const until=new Date(Date.now()+96*3600000).toISOString();
  const key=randomUUID();
  await event("delay",until,key);
  const first=await status();
  assert.equal(Date.parse(first.job.due_at),Date.parse(until));
  await event("delay",until,key);
  assert.deepEqual(await status(),first);
  await event("refused"); await event("resume"); await event("contact");
  assert.equal((await status()).job.reason,"refused");
});
test("J9 — opposition du prospect sur toutes ses demandes et annulation terminale",async()=>{
  const {id,event,status}=await automationFixture();
  for(const terminal of ["gagnee","perdue"]){
    await db.query("update quote_requests set status=$1 where id=$2",[terminal,id]);
    assert.equal((await status()).job.reason,terminal);
  }
  const other=(await db.query("insert into quote_requests(company_id,prospect_id,title,description) select company_id,prospect_id,title,description from quote_requests where id=$1 returning id",[id])).rows[0].id;
  const snapshot=async()=>(await db.query("select public.followup_automation_status($1,$2) as s",[a,other])).rows[0].s;
  await event("opt_out"); await event("preference","phone"); await event("resume");
  assert.equal((await snapshot()).job.reason,"opt_out");
  assert.equal((await status()).job.reason,"opt_out");
});
test("J9 — panne du traitement conservée et reprise après échéance",async()=>{
  const {id,status}=await automationFixture();
  await db.exec(`reset role;
    create function pg_temp.fail_schedule() returns trigger language plpgsql as $$
    begin if new.state='scheduled' then raise exception 'fixture'; end if; return new; end $$;
    create trigger fault before update on daxenvo_private.followup_job for each row execute function pg_temp.fail_schedule();`);
  await db.query("update daxenvo_private.followup_job set state='pending',due_at=null where request_id=$1",[id]);
  const tick=()=>db.query("select daxenvo_private.run_followups($1)",[a]);
  await tick();
  assert.equal((await status()).job.state,"error");
  assert.equal((await status()).job.reason,"P0001");
  await db.exec("drop trigger fault on daxenvo_private.followup_job");
  await db.query("update daxenvo_private.followup_job set due_at=now() where request_id=$1",[id]);
  await tick();
  assert.equal((await status()).job.state,"scheduled");
});
for(const [name,action] of Object.entries({
  anonymous:async({id})=>{await db.exec("set local role anon");return db.query("select public.followup_automation_status($1,$2)",[a,id])},
  outsider:async({id})=>{await signIn(outsider);return db.query("select public.followup_automation_status($1,$2)",[a,id])},
  tenant:async({id})=>db.query("select public.followup_automation_status($1,$2)",[b,id]),
  memberSettings:async({configure})=>{await signIn(alice);return configure()},
  memberResume:async({event})=>{await signIn(alice);return event("resume")},
  fakeDelivery:async({id})=>db.query("select daxenvo_private.confirm_followup_delivery($1,$2,1,'fake')",[a,id]),
})){
  test("J9 — refus "+name,async()=>{
    const fixture=await automationFixture();
    await assert.rejects(action(fixture),{code:"42501"});
  });
}
test("J9 — priorité, revue humaine et rôle owner", async()=>{
  const {row,write}=await qualificationFixture();
  await db.query("update followups set done=true where company_id=$1",[b]);
  await db.query("select public.configure_followup_automation($1,48,2,3,10)",[b]);
  await db.query("select public.followup_automation_event($1,$2,$3,'preference','sms')",[b,row.id,randomUUID()]);
  const state=async()=>(await db.query("select public.followup_automation_status($1,$2) as s",[b,row.id])).rows[0].s.job;
  const normal=await state();
  await write({result:{...ruleResult,priorite:"elevee",requiresHumanReview:false}});
  assert.equal(Date.parse(normal.due_at)-Date.parse((await state()).due_at),46*3600000);
  await write();
  assert.equal((await state()).reason,"qualification_review");
});
test("J9 — une préparation obsolète ne peut pas être confirmée", async()=>{
  const {id,status,configure,event}=await automationFixture();
  await db.exec("reset role");
  await db.query("update quote_requests set created_at=now()-interval '3 days' where id=$1",[id]);
  await configure(2);
  const prepared=(await db.query("select * from daxenvo_private.prepared_followups($1)",[a])).rows;
  assert.equal(prepared.length,1);
  assert.equal(prepared[0].channel,"email");
  await event("opt_out");
  assert.equal((await status()).job.sent_count,0);
  assert.deepEqual((await db.query("select * from daxenvo_private.prepared_followups($1)",[a])).rows,[]);
  await assert.rejects(db.query("select daxenvo_private.confirm_followup_delivery($1,$2,$3,'fixture')",[a,id,prepared[0].preparation_id]),{code:"PT409"});
});
test("J9 — appels simultanés au worker, un seul passage et une seule préparation",async()=>{
  const {id,status}=await automationFixture();
  await db.exec("reset role");
  await db.query("update quote_requests set created_at=now()-interval '3 days' where id=$1",[id]);
  await db.query("update daxenvo_private.followup_job set due_at=now() where request_id=$1",[id]);
  // PGlite serializes SQL on one connection; native lock contention is a separate check.
  const calls=await Promise.all(Array.from({length:4},()=>db.query("select daxenvo_private.run_followups($1) as n",[a])));
  assert.equal(calls.reduce((total,result)=>total+result.rows[0].n,0),1);
  assert.equal((await status()).history.filter(h=>h.state==="prepared").length,1);
});

test("J9 — une relance manuelle ouverte prend la main, sa clôture ne compte pas comme envoi", async()=>{
  const {status}=await automationFixture();
  await db.query("update followups set done=false where company_id=$1",[a]);
  assert.equal((await status()).job.reason,"manual_followup");
  await db.query("update followups set done=true where company_id=$1",[a]);
  assert.equal((await status()).job.state,"scheduled");
  assert.equal((await status()).job.sent_count,0);
});

test("J9 — ACL effectives des RPC, rôles et tables privées", async () => {
  const names = ["configure_followup_automation","followup_automation_event","followup_automation_status"];
  const {rows} = await db.query(`select n.nspname, p.prosecdef, r.rolname, r.rolbypassrls, r.rolcanlogin,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as member
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
    where proname=any($1) and n.nspname in ('public','daxenvo_private')`,[names]);
  assert.equal(rows.length,6);
  for (const row of rows) {
    assert.equal(row.anon,false);
    assert.equal(row.service,false);
    assert.equal(row.member,true);
    assert.equal(row.prosecdef,row.nspname==="daxenvo_private");
    if (row.prosecdef) {
      assert.equal(row.rolname,"daxenvo_followup_api");
      assert.equal(row.rolbypassrls,false);
      assert.equal(row.rolcanlogin,false);
    }
  }
  const tables = await db.query(`select relrowsecurity,
    has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') as access
    from pg_class where relnamespace='daxenvo_private'::regnamespace and relkind='r' and relname like 'followup_%'`);
  assert.equal(tables.rows.length,6);
  for (const row of tables.rows) assert.deepEqual(row,{relrowsecurity:true,access:false});
  const grants = await db.query(`select
    has_column_privilege('daxenvo_followup_api','daxenvo_private.followup_job','sent_count','UPDATE') as forge_count,
    has_function_privilege('daxenvo_followup_api','daxenvo_private.confirm_followup_delivery(uuid,uuid,bigint,text)','EXECUTE') as confirm,
    has_table_privilege('daxenvo_followup_api','daxenvo_private.qualification_writer','SELECT') as writer_secret`);
  assert.deepEqual(grants.rows,[{forge_count:false,confirm:false,writer_secret:false}]);
});

test("J9 — un délai déclaré par un member préserve le suivi humain jusqu’à la reprise autorisée",async()=>{
  const {event,status}=await automationFixture();
  await event("human");
  await signIn(alice);
  await event("delay",new Date(Date.now()+86400000).toISOString());
  assert.equal((await status()).job.reason,"human");
  await signIn(bob);
  await event("resume");
  assert.equal((await status()).job.state,"scheduled");
});

test("J9 — le rôle interne lit uniquement les sources du tenant établi par la fonction",async()=>{
  await db.exec("set local role daxenvo_followup_api");
  await db.query("select set_config('daxenvo.followup_company',$1,true)",[a]);
  assert.deepEqual((await db.query("select distinct company_id from public.quote_requests")).rows,[{company_id:a}]);
  assert.deepEqual((await db.query("select distinct company_id from daxenvo_private.followup_job")).rows,[{company_id:a}]);
});

test("J9 — contexte RLS restauré après RPC, répétition, déclencheur et refus", async()=>{
  const {id,status,configure,event}=await automationFixture();
  await db.query("select set_config('daxenvo.followup_company',$1,true)",[b]);
  const assertRestored=async()=>assert.equal((await db.query(
    "select current_setting('daxenvo.followup_company') as tenant")).rows[0].tenant,b);
  await status();
  await assertRestored();
  await configure(14);
  await assertRestored();
  await configure(14);
  await assertRestored();
  const op=randomUUID();
  await event("human",null,op);
  await assertRestored();
  await event("human",null,op);
  await assertRestored();
  await db.query("update quote_requests set status='en_cours' where id=$1",[id]);
  await assertRestored();
  await db.query("update followups set done=false where request_id=$1",[id]);
  await assertRestored();
  await db.exec("savepoint denied");
  await assert.rejects(db.query("select public.followup_automation_status($1,$2)",[b,id]),{code:"42501"});
  await db.exec("rollback to denied");
  await assertRestored();
});
test("J9 — aucun paramètre personnalisé dans la définition des fonctions privilégiées",async()=>{
  const {rows}=await db.query(`select proconfig from pg_proc
    where proowner='daxenvo_followup_api'::regrole and prosecdef`);
  assert.equal(rows.length,5);
  for (const {proconfig} of rows) {
    assert.ok(proconfig.includes("lock_timeout=3s"));
    assert.ok(proconfig.every(setting=>!setting.startsWith("daxenvo.")));
  }
});

async function bookingFixture() {
  const binding=randomUUID(), key=createHash("sha256").update(randomUUID()).digest();
  const {rows:[request]}=await db.query("select id from public.quote_requests where company_id=$1",[a]);
  await db.query("insert into daxenvo_private.booking_calendar(company_id,binding,writer_digest) values($1,$2,$3)",[a,binding,key]);
  async function command(command,fields={},user=bob,tenant=a,target=request.id) {
    await signIn(user);
    const message=JSON.stringify({purpose:"booking.v1",nonce:randomUUID(),binding,command,fields:command==="reserve"?{invitee_hash:"01".repeat(32),...fields}:fields,actor:user,company:tenant,request:target,expires:Math.floor(Date.now()/1000)+45});
    const signature=createHmac("sha256",key).update(message).digest("hex");
    return (await db.query("select public.booking_command($1,$2) as result",[message,signature])).rows[0].result;
  }
  const slot={operation:randomUUID(),title:"Visite fictive",zone:"Europe/Paris",start:"2030-05-15T12:00:00Z",minutes:30};
  return {command,slot,request,binding,key};
}
test("J10 — proposition, réservation unique, observation, déplacement et annulation",async()=>{
  const {command,slot,request}=await bookingFixture();
  // Enable J9 so the booking alone explains suppression, then retain an opposition on cancellation.
  await signIn(bob);
  await db.query("update followups set done=true where company_id=$1",[a]);
  await db.query("select public.configure_followup_automation($1,24,6,2,10)",[a]);
  await db.query("select public.followup_automation_event($1,$2,$3,'preference','email')",[a,request.id,randomUUID()]);
  const {booking}=await command("propose",slot);
  const {id}=booking;
  assert.equal((await command("propose",slot)).booking.id,id);
  assert.equal(booking.state,"proposed");
  assert.equal((await command("reserve",{id})).dispatch,true);
  assert.equal((await command("reserve",{id})).dispatch,false);
  const proof={id,revision:2,status:"confirmed",reference:"provider/1",start:slot.start,minutes:30,updated:"2029-01-01T00:00:00Z"};
  const first=(await command("observe",proof)).booking;
  assert.equal(first.state,"confirmed");
  const follow=async()=>(await db.query("select public.followup_automation_status($1,$2) as s",[a,request.id])).rows[0].s.job.reason;
  assert.equal(await follow(),"confirmed_appointment");
  assert.equal((await command("observe",proof)).booking.revision,first.revision);
  const moved=(await command("observe",{...proof,revision:first.revision,start:"2030-05-16T12:00:00Z",reference:"provider/2",updated:"2029-01-02T00:00:00Z"})).booking;
  assert.equal((await db.query("select starts_at from appointments where id=$1",[id])).rows[0].starts_at.toISOString(),"2030-05-16T12:00:00.000Z");
  assert.equal((await command("observe",{...proof,revision:moved.revision})).booking.reference,"provider/2");
  assert.equal((await db.query("delete from appointments where id=$1",[id])).affectedRows,0);
  await db.query("select public.followup_automation_event($1,$2,$3,'opt_out')",[a,request.id,randomUUID()]);
  const cancel=await command("cancel",{id});
  assert.equal(cancel.dispatch,true);
  assert.equal((await command("cancel",{id})).dispatch,false);
  await command("observe",{...proof,revision:cancel.booking.revision,status:"cancelled",updated:"2029-01-03T00:00:00Z"});
  assert.equal((await db.query("select id from appointments where id=$1",[id])).rows.length,0);
  assert.equal(await follow(),"opt_out");
});
test("J10 — deux propositions incompatibles et slot protégé pendant une panne",async()=>{
  const {command,slot}=await bookingFixture();
  const {booking:b1}=await command("propose",slot);
  const {booking:b2}=await command("propose",{...slot,operation:randomUUID(),start:"2030-05-15T12:15:00Z"});
  await command("reserve",{id:b1.id});
  const failure=await command("failure",{id:b1.id,revision:2,error:"CALENDAR_UNAVAILABLE",delay:30});
  assert.equal(failure.booking.state,"error");
  assert.equal((await command("reserve",{id:b1.id})).dispatch,false);
  await assert.rejects(command("reserve",{id:b2.id}),{code:"PT409"});
});
test("J10 — un membre ne peut pas annuler",async()=>{
  const {command,slot}=await bookingFixture();
  const {booking}=await command("propose",slot,alice);
  await assert.rejects(command("cancel",{id:booking.id},alice),{code:"42501"});
});
test("J10 — accès à une demande d’une autre entreprise refusé",async()=>{
  const {command}=await bookingFixture();
  const other=(await db.query("select id from quote_requests where company_id=$1",[b])).rows[0].id;
  await assert.rejects(command("list",{},bob,a,other),{code:"PT404"});
});
test("J10 — les confirmations RPC directes non signées sont refusées",async()=>{
  await bookingFixture();
  await signIn(alice);
  const msg=JSON.stringify({company:a,actor:alice,command:"observe",purpose:"booking.v1"});
  await assert.rejects(db.query("select public.booking_command($1,$2)",[msg,"00".repeat(32)]),{code:"42501"});
});

test("J10 — propriétaires confinés et droits effectifs des déclencheurs",async()=>{
  const {rows}=await db.query(`select proname,rolname,rolsuper,rolcanlogin,rolbypassrls,
    has_function_privilege('authenticated',p.oid,'execute') as client,
    has_table_privilege(rolname,'daxenvo_private.booking_calendar','select') as config
    from pg_proc p join pg_roles r on r.oid=p.proowner
    where pronamespace='daxenvo_private'::regnamespace and proname in
    ('project_booking','booking_slot_guard','booking_source_guard','booking_followup_guard','booking_reevaluate')`);
  assert.equal(rows.length,5);
  for(const row of rows){
    assert.equal(row.rolname,row.proname==='project_booking'?'daxenvo_booking_projection':
      row.proname==='booking_source_guard'?'daxenvo_booking_source':row.proname==='booking_reevaluate'?'daxenvo_followup_api':'daxenvo_booking_guard');
    assert.ok(!row.rolsuper && !row.rolcanlogin && !row.rolbypassrls && !row.client && !row.config);
  }
});
test("J10 — signature consommée une seule fois et expiration",async()=>{
  const {request,binding,key}=await bookingFixture();
  await signIn(bob);
  const signed=(offset)=>{
    const message=JSON.stringify({actor:bob,company:a,request:request.id,binding,command:"list",
      purpose:"booking.v1",fields:{},expires:Math.floor(Date.now()/1000)+offset});
    return [message,createHmac("sha256",key).update(message).digest("hex")];
  };
  const call=(args)=>db.query("select public.booking_command($1,$2)",args);
  const args=signed(45);
  await call(args);
  await db.exec("savepoint replay");
  await assert.rejects(call(args),{code:"42501"});
  await db.exec("rollback to replay");
  await assert.rejects(call(signed(-10)),{code:"42501"});
});

const dashboard = async (tenant, panel, term = "", facet = "", cursor = "", related = null) =>
  (await db.query("select public.client_dashboard($1,$2,$3,$4,$5,$6) as result",
    [tenant,panel,term,facet,cursor,related])).rows[0].result;

test("J11 — indicateurs exacts, projection des listes et périmètre du rôle lecteur", async () => {
  await signIn(bob);
  assert.deepEqual(await dashboard(a,"synthese"), {
    prospects:1,new:1,open:1,priority:0,won:0,lost:0,attention:0,scheduled:0,confirmed:0,
  });
  for (const panel of ["prospects","demandes","relances","rendez-vous","activite"]) {
    assert.ok((await dashboard(a,panel)).length>0,panel);
  }
  assert.deepEqual(await dashboard(a,"parametres"),{policy:null,calendar:false});
  await assert.rejects(dashboard(b,"synthese"),{code:"42501"});
});

test("J11 — pagination, recherche littérale et choix explicite du tenant multi-membre",async () => {
  await signIn(alice);
  const before = await dashboard(a,"prospects");
  await db.query("insert into public.prospects(company_id,name,city,sector) select $1,'Prospect '||i,'Paris','Test' from generate_series(1,28) i",[a]);
  const first = await dashboard(a,"prospects","Prospect","Test");
  assert.equal(first.length,26);
  const second = await dashboard(a,"prospects","Prospect","Test",first[24].key);
  assert.equal(second.length,3);
  assert.equal(new Set([...first.slice(0,25),...second].map(p=>p.id)).size,28);
  assert.deepEqual(await dashboard(a,"prospects","%"),[]);
  assert.equal((await dashboard(b,"synthese")).prospects,1);
  assert.equal((await dashboard(b,"demandes","","","",before[0].id)).length,0);
});

test("J11 — absence de secrets, de privilèges d’écriture et d’accès anonyme",async () => {
  const {rows:[r]}=await db.query(`select has_column_privilege('daxenvo_dashboard_reader','daxenvo_private.booking_calendar','writer_digest','select') as secret,
    has_table_privilege('daxenvo_dashboard_reader','public.prospects','insert') as writer,
    has_table_privilege('authenticated','daxenvo_private.bookings','select') as direct,
    has_function_privilege('anon','public.client_dashboard(uuid,text,text,text,text,uuid)','execute') as anonymous`);
  assert.deepEqual(r,{secret:false,writer:false,direct:false,anonymous:false});
});
