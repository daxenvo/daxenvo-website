import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const origin = "http://127.0.0.1:3128";
const headers = {origin};
const beta = "20000000-0000-4000-8000-000000000002";
const base = "/api/quote-requests";
const path = (id: string) => base + "/" + id + "/qualifications";
async function login(api: APIRequestContext, name = "alice") {
  const res = await api.post("/auth/connexion", {headers, maxRedirects:0,
    form:{email:name+"@example.invalid",password:"test-only"}});
  expect(res.headers().location).toBe("/espace");
}
async function fixture(api: APIRequestContext) {
  const p = await api.post("/api/prospects",{headers,data:{name:"Contact J6",city:"Paris",sector:"Peinture"}});
  const prospect = (await p.json()).data.id;
  const res = await api.post(base,{headers,data:{prospect_id:prospect,title:"Devis",description:"Peindre les murs du salon",
    project_type:"Peinture",city:"Paris",requested_timeline:"Dès que possible",status:"gagnee"}});
  expect(res.status()).toBe(201);
  return (await res.json()).data.id as string;
}

test("J6 réel, budget inconnu, provenance, concurrence et pagination", async ({request}) => {
  await login(request, "bob");
  const id = await fixture(request);
  const url = path(id);
  expect((await request.get(url+"/latest")).status()).toBe(404);
  const calls = await Promise.all([request.post(url,{headers}),request.post(url,{headers})]);
  for (const res of calls) expect(res.status()).toBe(201);
  const first = (await (await request.get(url+"?limit=1")).json());
  expect(first.nextCursor).toBe(2);
  const latest = (await (await request.get(url+"/latest")).json()).data;
  expect(first.data).toEqual([latest]);
  expect(latest.result).toEqual({
    version:"j6-regles-v1", priorite:"elevee", analysePar:"regles", fournisseur:null,
    repli:{code:"IA_NON_CONFIGUREE"}, requiresHumanReview:true, informationsManquantes:["budget"],
    signaux:["Type de projet fourni","Calendrier déclaré"], motif:"Projet annoncé comme urgent ou à démarrer sous un mois",
    actionRecommandee:"Contacter rapidement le prospect pour clarifier ses besoins",
  });
  expect(JSON.stringify(latest)).not.toContain("Peindre les murs");
  expect((await (await request.get(url+"?before=2&limit=1")).json()).data[0].revision).toBe(1);
  expect((await (await request.get(base+"/"+id)).json()).data.status).toBe("gagnee");
  await request.patch(base+"/"+id,{headers,data:{budget:200,status:"perdue"}});
  const third = (await (await request.post(url,{headers})).json()).data;
  expect(third.result).toMatchObject({informationsManquantes:[],requiresHumanReview:false});
  expect(third.result.signaux).toContain("Budget déclaré");
  expect((await (await request.get(base+"/"+id)).json()).data.status).toBe("perdue");
});
test("L’entreprise active contrôle la lecture et le déclenchement", async ({request}) => {
  await login(request);
  const id = await fixture(request);
  const url = path(id);
  expect((await request.post(url,{headers})).status()).toBe(201);
  await request.post("/auth/entreprise",{headers,maxRedirects:0,form:{company_id:beta}});
  for (const target of [url,url+"/latest"]) expect((await request.get(target)).status()).toBe(404);
  expect((await request.post(url,{headers})).status()).toBe(404);
  await login(request,"bob");
  expect((await request.post(url,{headers})).status()).toBe(404);
});
test("Entrées et provenance imposées, demandes absentes ou supprimées", async ({request}) => {
  await login(request);
  const id = await fixture(request);
  const url = path(id);
  for (const data of [{company_id:beta},{analysePar:"ia"},{result:{}},{tenantId:beta}])
    expect((await request.post(url,{headers,data})).status()).toBe(400);
  for (const query of ["?company_id="+beta,"?limit=101","?before=0"])
    expect((await request.get(url+query)).status()).toBe(400);
  expect((await request.post(url,{headers:{origin:"https://example.invalid"}})).status()).toBe(403);
  expect((await request.patch(url,{headers,data:{}})).status()).toBe(405);
  expect((await request.delete(base+"/"+id,{headers})).status()).toBe(204);
  for (const target of [url,path(randomUUID())]) {
    expect((await request.post(target,{headers})).status()).toBe(404);
    expect((await request.get(target)).status()).toBe(404);
  }
});
test("Session absente, absence d’entreprise et fournisseur indisponible", async ({request}) => {
  for (const [account,status] of [["",401],["isolated",403],["offline",503]] as const) {
    if (account) await login(request,account);
    const res = await request.post(path(randomUUID()),{headers});
    expect(res.status()).toBe(status);
    expect(res.headers()["cache-control"]).toContain("no-store");
  }
});
for (const renewable of [false,true]) {
  test("Qualification avec session expirée, renouvelable="+renewable, async ({request,playwright})=>{
    await login(request);
    const id = await fixture(request);
    const state = await request.storageState();
    const cookie = state.cookies.find(c=>c.name.endsWith("auth-token"))!;
    const session = JSON.parse(Buffer.from(cookie.value.slice(7),"base64url").toString());
    session.expires_at = 1;
    if (!renewable) session.refresh_token = "expired-fixture";
    cookie.value = "base64-"+Buffer.from(JSON.stringify(session)).toString("base64url");
    const api = await playwright.request.newContext({baseURL:origin,storageState:state});
    try {
      const res = await api.post(path(id),{headers});
      expect(res.status()).toBe(renewable ? 201 : 401);
      expect(res.headers()["set-cookie"]).toContain(cookie.name+"=");
      expect(res.headers()["cache-control"]).toContain("no-store");
    } finally {await api.dispose();}
  });
}

test("Le POST traduit le conflit de source et distingue permission et sérialisation", async ({request}) => {
  await login(request);
  const id = await fixture(request);
  const url = path(id);
  const cookie = (await request.storageState()).cookies.find(c => c.name.endsWith("auth-token"))!;
  const session = JSON.parse(Buffer.from(cookie.value.slice(7), "base64url").toString());
  for (const [status, code, message, expectedStatus, error] of [
    [409, "PT409", "SOURCE_CHANGED", 409, "SOURCE_CHANGED"],
    [500, "40001", "Qualification source changed", 409, "SOURCE_CHANGED"],
    [403, "42501", "insufficient privilege", 403, "FORBIDDEN"],
    [500, "40001", "could not serialize access due to concurrent update", 503, "UNAVAILABLE"],
  ] as const) {
    const setup = await request.post("http://127.0.0.1:3129/rest/v1/test/next-qualification-error", {
      headers: {authorization: "Bearer " + session.access_token},
      data: {requestId: id, response: {status, body: {code, message, details: null, hint: null}}},
    });
    expect(setup.status()).toBe(200);
    const response = await request.post(url, {headers});
    expect(response.status()).toBe(expectedStatus);
    expect(await response.json()).toEqual({error});
  }
  expect((await (await request.get(url)).json()).data).toEqual([]);
});
