import assert from "node:assert/strict";
import { before, after, beforeEach, afterEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const sqlFile = (path) => readFile(new URL(path, import.meta.url), "utf8");
const a = "20000000-0000-4000-8000-000000000001";
const b = "20000000-0000-4000-8000-000000000002";
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";
const outsider = "10000000-0000-4000-8000-000000000003";

before(async () => {
  // Seule l'identité Auth est simulée. PostgreSQL applique privilèges, RLS et contraintes.
  await db.exec(`
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
      return db.query("select * from record_request_qualification($1,$2,$3,$4,$5)",
        [args.company,args.id,JSON.stringify(args.source),JSON.stringify(args.result),args.writer]);
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
  ["source modifiée",{source:{}},"40001"],
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
