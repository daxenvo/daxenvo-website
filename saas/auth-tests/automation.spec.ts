import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:3128";
const settings = "/api/followup-automation/settings";
const path = "/api/quote-requests/20000000-0000-4000-8000-000000000001/followup-automation";
const headers = { origin };
test("J9 — session, origine et cache privé", async ({request}) => {
  const anonymous = await request.get(path);
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["cache-control"]).toContain("no-store");
  expect((await request.post(path,{headers:{origin:"https://example.invalid"},data:{}})).status()).toBe(403);
});
test("J9 — un membre ne peut ni configurer ni reprendre le traitement", async ({request}) => {
  await request.post("/auth/connexion",{headers,form:{email:"bob@example.invalid",password:"test-only"}});
  expect((await request.put(settings,{headers,data:{}})).status()).toBe(403);
  expect((await request.post(path,{headers,data:{operation:crypto.randomUUID(),kind:"resume"}})).status()).toBe(403);
  expect((await request.post(path,{headers,data:{operation:crypto.randomUUID(),kind:"contact",company_id:crypto.randomUUID()}})).status()).toBe(400);
  expect((await request.get(path+"?before=-1")).status()).toBe(400);
});
test("J9 — l’historique suit l’entreprise active pour un utilisateur multientreprises",async({request})=>{
  await request.post("/auth/connexion",{headers,form:{email:"alice@example.invalid",password:"test-only"}});
  const prospect=await request.post("/api/prospects",{headers,data:{name:"Fixture J9",sector:"Test",city:"Paris"}});
  const prospectId=(await prospect.json()).data.id;
  const quote=await request.post("/api/quote-requests",{headers,data:{prospect_id:prospectId,title:"Test J9",description:"Qualification fictive"}});
  const id=(await quote.json()).data.id;
  const history="/api/quote-requests/"+id+"/followup-automation";
  expect((await (await request.get(history)).json()).job.request_id).toBe(id);
  await request.post("/auth/entreprise",{headers,form:{company_id:"20000000-0000-4000-8000-000000000002"},maxRedirects:0});
  expect((await request.get(history)).status()).toBe(404);
});
