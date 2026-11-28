import assert from "node:assert/strict";
import test from "node:test";
import { ledgerConnection } from "./connection.ts";

const ref = "mniconjzkvvvwqoxtzwu";
const api = `https://${ref}.supabase.co`;
const direct = `db.${ref}.supabase.co`;
const host = "aws-1-eu-west-3.pooler.supabase.com";
const login = "daxenvo_ai_runtime_j122";
const user = `${login}.${ref}`;
const uri = (u: string, h: string, port = 5432) => `postgresql://${u}:fixture%40value@${h}:${port}/postgres`;
for (const [name, u, h] of [["direct", login, direct], ["session", user, host]]) {
  test(name + " binds the dedicated login, TLS peer and port", () => {
    const result = ledgerConnection(uri(u,h), api, host);
    assert.deepEqual(result, {host:h, username:u, database:"postgres", port:5432, password:"fixture@value",
      ssl:{rejectUnauthorized:true,servername:h}});
  });
}
test("rejects privileged roles, wrong project, unpinned hosts and TLS overrides", () => {
  for (const invalid of [uri("daxenvo_ai_runtime",direct),uri("daxenvo_ai_runtime."+ref,host),uri("postgres",direct),uri("postgres."+ref,host),uri("service_role."+ref,host),
    uri(login,host),uri(user,direct),uri(login+"."+ "a".repeat(20),host),uri(user,host,6543),
    uri(user,host)+ "?sslmode=disable",uri(user,host+".example.org"),"invalid"]) {
    assert.equal(ledgerConnection(invalid,api,host),null);
  }
  assert.equal(ledgerConnection(uri(user,host),api,undefined),null);
});
