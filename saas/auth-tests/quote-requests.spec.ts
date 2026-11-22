import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3128";
const headers = { origin };
const beta = "20000000-0000-4000-8000-000000000002";
const path = "/api/quote-requests";

test("Devis et prospect de la même entreprise, rôles et pagination", async ({request}) => {
  const login = async (name: string) => {
    const res = await request.post("/auth/connexion",{headers,maxRedirects:0,
      form:{email:name+"@example.invalid",password:"test-only"}});
    expect(res.headers().location).toBe("/espace");
  };
  const prospect = async () => {
    const res = await request.post("/api/prospects", {headers,data:{name:"Contact devis",sector:"Peinture",city:"Nantes"}});
    expect(res.status()).toBe(201);
    return (await res.json()).data.id as string;
  };
  const selectBeta = () => request.post("/auth/entreprise",{headers,maxRedirects:0,form:{company_id:beta}});
  await login("alice");
  const foreign = await prospect();
  const fields = {prospect_id:foreign,title:"Travaux",description:"Peindre le salon",budget:25.15};
  const alphaQuote = await request.post(path,{headers,data:fields});
  expect(alphaQuote.status()).toBe(201);
  const alphaItem = path + "/" + (await alphaQuote.json()).data.id;
  await selectBeta();
  expect((await request.post(path,{headers,data:fields})).status()).toBe(409);
  expect((await request.get(alphaItem)).status()).toBe(404);
  expect((await request.patch(alphaItem,{headers,data:{title:"Autre"}})).status()).toBe(404);
  expect((await request.delete(alphaItem,{headers})).status()).toBe(404);
  await login("bob");
  const local = await prospect();
  const valid = {...fields,prospect_id:local};
  const ids: string[] = [];
  for (let i=0;i<2;i++) {
    const res = await request.post(path,{headers,data:valid});
    expect(res.status()).toBe(201);
    ids.push((await res.json()).data.id);
  }
  const item = path + "/" + ids[0];
  expect((await request.get(item)).status()).toBe(200);
  const res = await request.patch(item,{headers,data:{status:"en_cours",city:"Paris"}});
  expect((await res.json()).data).toMatchObject({status:"en_cours",city:"Paris"});
  expect((await request.delete(item,{headers})).status()).toBe(403);
  expect((await request.patch(item,{headers,data:{prospect_id:foreign}})).status()).toBe(409);
  for (const data of [{company_id:beta},{status:"inconnu"},{budget:-1},{budget:1.001},{title:"x"}])
    expect((await request.patch(item,{headers,data})).status()).toBe(400);
  expect((await request.patch(item,{headers:{origin:"https://example.invalid"},data:{city:"Paris"}})).status()).toBe(403);
  const first = await (await request.get(path+"?limit=1")).json();
  const second = await (await request.get(path+"?limit=1&after="+first.nextCursor)).json();
  expect(first.data).toHaveLength(1);
  expect(second.data[0].id > first.data[0].id).toBe(true);
  await login("alice");
  expect((await request.delete(alphaItem,{headers})).status()).toBe(204);
  await selectBeta();
  for (const id of ids) expect((await request.delete(path+"/"+id,{headers})).status()).toBe(204);
  expect((await request.get(item)).status()).toBe(404);
});

for (const renewable of [true,false]) {
  test("Session SSR sur API métier, renouvelable="+renewable, async ({request: api, playwright}) => {
    await api.post("/auth/connexion",{headers,maxRedirects:0,form:{email:"alice@example.invalid",password:"test-only"}});
    const state = await api.storageState();
    const cookie = state.cookies.find(c=>c.name.endsWith("auth-token"))!;
    const session = JSON.parse(Buffer.from(cookie.value.slice(7),"base64url").toString());
    session.expires_at = 1;
    if (!renewable) session.refresh_token = "expired-fixture";
    cookie.value = "base64-"+Buffer.from(JSON.stringify(session)).toString("base64url");
    const expired = await playwright.request.newContext({baseURL:origin, storageState:state});
    const res = await expired.get(path);
    expect(res.status()).toBe(renewable ? 200 : 401);
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["set-cookie"]).toContain(cookie.name+"=");
    if (!renewable) expect((await res.json()).error).toBe("UNAUTHENTICATED");
    await expired.dispose();
  });
}
