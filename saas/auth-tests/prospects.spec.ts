import { expect, test, type APIRequestContext } from "@playwright/test";

const origin = "http://127.0.0.1:3128";
const beta = "20000000-0000-4000-8000-000000000002";
const path = "/api/prospects";
const prospect = { name: "Entreprise Test", sector: "Peinture", city: "Nantes" };
const headers = { origin };
async function login(api: APIRequestContext, account = "alice") {
  const res = await api.post("/auth/connexion", { headers, maxRedirects: 0, form: {
    email: account + "@example.invalid", password: "test-only",
  } });
  expect(res.headers().location).toBe("/espace");
}

test("CRUD prospects, pagination et entreprise active", async ({ request }) => {
  await login(request);
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const res = await request.post(path, { headers, data: prospect });
    expect(res.status()).toBe(201);
    ids.push((await res.json()).data.id);
  }
  const first = await (await request.get(path + "?limit=1")).json();
  expect(first.data).toHaveLength(1);
  expect(first.nextCursor).toBe(first.data[0].id);
  const second = await (await request.get(path + "?limit=1&after=" + first.nextCursor)).json();
  expect(second.data[0].id > first.nextCursor).toBe(true);
  const item = path + "/" + ids[0];
  expect((await request.get(item)).status()).toBe(200);
  expect((await (await request.patch(item, { headers, data: {city:"Paris"} })).json()).data.city).toBe("Paris");
  await request.post("/auth/entreprise", { headers, form: { company_id: beta }, maxRedirects: 0 });
  for (const method of ["GET","PATCH","DELETE"]) {
    const res = await request.fetch(item, {method, headers, data: method === "PATCH" ? prospect : undefined});
    expect(res.status()).toBe(404);
  }
  expect((await (await request.get(path)).json()).data.some((r: {id:string})=>ids.includes(r.id))).toBe(false);
  const own = await (await request.post(path,{headers,data:prospect})).json();
  expect((await request.delete(path + "/" + own.data.id, {headers})).status()).toBe(204);
  await login(request);
  for (const id of ids) expect((await request.delete(path+"/"+id,{headers})).status()).toBe(204);
});

test("Validation stricte, origine, taille et rôle membre", async ({ request }) => {
  await login(request, "bob");
  const item = path + "/10000000-0000-4000-8000-000000000001";
  expect((await request.delete(item,{headers})).status()).toBe(403);
  for (const data of [{...prospect,company_id:beta},{...prospect,name:"x"},{}])
    expect((await request.post(path,{headers,data})).status()).toBe(400);
  for (const data of [{company_id:beta},{}])
    expect((await request.patch(item,{headers,data})).status()).toBe(400);
  for (const suffix of ["?limit=101","?limit=1&limit=2","?company_id="+beta,"/invalid"])
    expect((await request.get(path+suffix)).status()).toBe(400);
  for (const method of ["POST","PATCH","DELETE"]) {
    const res = await request.fetch(method === "POST" ? path : item,
      {method,headers:{origin:"https://example.invalid"},data:prospect});
    expect(res.status()).toBe(403);
  }
  expect((await request.post(path,{headers,data:{...prospect,name:"x".repeat(33000)}})).status()).toBe(413);
});

test("Session absente, entreprise absente et service indisponible", async ({request}) => {
  for (const [account,status] of [["",401],["isolated",403],["offline",503]] as const) {
    if (account) await login(request,account);
    const res = await request.get(path);
    expect(res.status()).toBe(status);
    expect(res.headers()["cache-control"]).toContain("no-store");
  }
});
