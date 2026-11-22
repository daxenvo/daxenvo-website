import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

const origin = "http://127.0.0.1:3128";
const headers = { origin };
const beta = "20000000-0000-4000-8000-000000000002";
type Fields = Record<string, string | boolean | number>;
type Cases = {
  path: string;
  create: Fields;
  stored: Fields;
  patch: Fields;
  updated: Fields;
  invalid: Fields[];
};

async function login(api: APIRequestContext, name: string) {
  const response = await api.post("/auth/connexion", { headers, maxRedirects: 0,
    form: { email: name + "@example.invalid", password: "test-only" } });
  expect(response.headers().location).toBe("/espace");
}

async function createRow(api: APIRequestContext, path: string, data: Fields) {
  const res = await api.post(path, { headers, data });
  expect(res.status()).toBe(201);
  return (await res.json()).data;
}

async function quote(api: APIRequestContext) {
  const contact = await createRow(api, "/api/prospects", { name: "Contact", sector: "Travaux", city: "Nantes" });
  const row = await createRow(api, "/api/quote-requests", {
    prospect_id: contact.id, title: "Travaux", description: "Projet de peinture",
  });
  return { id: row.id as string, contact: contact.id as string };
}

export function requestChildTests(cases: Cases) {
  const { path } = cases;
  test("CRUD, pagination, relations et permissions de l’entreprise active", async ({ request }) => {
    await login(request, "alice");
    const alphaQuote = await quote(request);
    const alpha = await createRow(request, path, { ...cases.create, request_id: alphaQuote.id });
    expect(alpha).toMatchObject(cases.stored);

    const selectBeta = () => request.post("/auth/entreprise", { headers, maxRedirects: 0, form: { company_id: beta } });
    await selectBeta();
    const foreignItem = path + "/" + alpha.id;
    expect((await request.get(foreignItem)).status()).toBe(404);
    expect((await request.patch(foreignItem, { headers, data: cases.patch })).status()).toBe(404);
    expect((await request.delete(foreignItem, { headers })).status()).toBe(404);
    expect((await (await request.get(path)).json()).data).toEqual([]);
    for (const request_id of [alphaQuote.id, randomUUID()]) {
      const res = await request.post(path, { headers, data: { ...cases.create, request_id } });
      expect(res.status()).toBe(409);
      expect((await res.json()).error).toBe("RELATION_CONFLICT");
    }

    await login(request, "bob");
    const betaQuote = await quote(request);
    const data = { ...cases.create, request_id: betaQuote.id };
    const first = await createRow(request, path, data);
    const second = await createRow(request, path, data);
    const ids = [first.id, second.id].sort();
    const one = await (await request.get(path + "?limit=1")).json();
    expect(one.data.map((row: {id: string}) => row.id)).toEqual(ids.slice(0, 1));
    expect(one.nextCursor).toBe(ids[0]);
    const two = await (await request.get(path + "?limit=1&after=" + one.nextCursor)).json();
    expect(two.data.map((row: {id: string}) => row.id)).toEqual(ids.slice(1));
    expect(two.nextCursor).toBeNull();
    const item = path + "/" + first.id;
    expect((await (await request.get(item)).json()).data).toMatchObject({ ...cases.stored, request_id: betaQuote.id });
    const changed = await request.patch(item, { headers, data: cases.patch });
    expect(changed.status()).toBe(200);
    expect((await changed.json()).data).toMatchObject(cases.updated);
    expect((await request.delete(item, { headers })).status()).toBe(403);
    for (const fields of [...cases.invalid, { company_id: beta }]) {
      expect((await request.post(path, { headers, data: { ...data, ...fields } })).status()).toBe(400);
      expect((await request.patch(item, { headers, data: fields })).status()).toBe(400);
    }
    expect((await request.patch(item, { headers, data: { request_id: alphaQuote.id } })).status()).toBe(400);
    expect((await request.patch(item, { headers, data: {} })).status()).toBe(400);
    expect((await request.get(path + "?limit=101")).status()).toBe(400);
    expect((await request.post(path, { headers: { origin: "https://example.invalid" }, data })).status()).toBe(403);

    await login(request, "alice");
    expect((await request.delete(foreignItem, { headers })).status()).toBe(204);
    expect((await request.get(foreignItem)).status()).toBe(404);
    await request.delete("/api/quote-requests/" + alphaQuote.id, { headers });
    await request.delete("/api/prospects/" + alphaQuote.contact, { headers });
    await selectBeta();
    for (const id of ids) expect((await request.delete(path + "/" + id, { headers })).status()).toBe(204);
    await request.delete("/api/quote-requests/" + betaQuote.id, { headers });
    await request.delete("/api/prospects/" + betaQuote.contact, { headers });
  });

  test("Accès anonyme, absence d’adhésion et indisponibilité", async ({ request }) => {
    for (const [name, status] of [["", 401], ["isolated", 403], ["offline", 503]] as const) {
      if (name) await login(request, name);
      const res = await request.get(path);
      expect(res.status()).toBe(status);
      expect(res.headers()["cache-control"]).toContain("no-store");
    }
  });

  for (const renewable of [false, true]) {
    test("Session expirée, renouvelable=" + renewable, async ({ request, playwright }) => {
      await login(request, "alice");
      const state = await request.storageState();
      const cookie = state.cookies.find(entry => entry.name.endsWith("auth-token"))!;
      const session = JSON.parse(Buffer.from(cookie.value.slice(7), "base64url").toString());
      session.expires_at = 1;
      if (!renewable) session.refresh_token = "expired-fixture";
      cookie.value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
      const api = await playwright.request.newContext({ baseURL: origin, storageState: state });
      try {
        const res = await api.get(path);
        expect(res.status()).toBe(renewable ? 200 : 401);
        expect(res.headers()["set-cookie"]).toContain(cookie.name + "=");
        expect(res.headers()["cache-control"]).toContain("no-store");
      } finally { await api.dispose(); }
    });
  }
}
