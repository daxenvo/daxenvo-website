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
