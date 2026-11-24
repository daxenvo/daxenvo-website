// PostgREST double for route tests. Tenant isolation must come from the route's filters.
import { createHash, createHmac, randomUUID } from "node:crypto";
const tables = new Map([["prospects", new Map()], ["quote_requests", new Map()], ["followups", new Map()], ["appointments", new Map()], ["request_qualifications", new Map()]]);

export function businessReply(request, url, input, reply, actor) {
  if (url.pathname === "/rest/v1/rpc/record_request_qualification") {
    const key = createHash("sha256").update(process.env.QUALIFICATION_WRITER_TOKEN).digest();
    if (createHmac("sha256", key).update(input.p_message).digest("hex") !== input.p_signature)
      return reply(403, {code: "42501"});
    const {company: p_company, request: p_request, result: p_result, actor: signer} = JSON.parse(input.p_message);
    if (signer !== actor) return reply(403, {code: "42501"});
    const row = tables.get("quote_requests").get(p_request);
    if (!row || row.company_id !== p_company) return reply(404, {code: "P0002"});
    const history = tables.get("request_qualifications");
    const revision = 1 + [...history.values()].filter(h => h.request_id === p_request).length;
    const saved = {id: randomUUID(), company_id: p_company, request_id: p_request,
      revision, created_by: actor, created_at: new Date().toISOString(), result: p_result};
    history.set(saved.id, saved);
    return reply(200, saved);
  }
  const table = tables.get(url.pathname.split("/").pop());
  if (!table) return reply(404, {});
  const params = url.searchParams;
  const method = request.method;
  let rows = [...table.values()].filter(row =>
    ["company_id", "id", "request_id", "revision"].every(key => {
      const filter = params.get(key);
      if (!filter) return true;
      if (filter.startsWith("lt.")) return row[key] < Number(filter.slice(3));
      if (filter.startsWith("gt.")) return row[key] > filter.slice(3);
      return filter === "eq." + row[key];
    }));
  if (method === "POST") {
    const defaults = url.pathname.endsWith("/quote_requests")
      ? {project_type:"", city:"", budget:0, requested_timeline:"", status:"nouvelle"} : {};
    const row = { ...defaults, id: randomUUID(), created_at: new Date().toISOString(), ...input };
    table.set(row.id, row);
    rows = [row];
  } else if (method === "PATCH") {
    for (const row of rows) Object.assign(row, input);
  } else if (method === "DELETE") {
    for (const row of rows) table.delete(row.id);
  }
  if (params.get("order") === "id.asc") rows.sort((a,b) => a.id.localeCompare(b.id));
  if (params.get("order") === "revision.desc") rows.sort((a,b) => b.revision - a.revision);
  if (params.has("limit")) rows = rows.slice(0, Number(params.get("limit")));
  if (request.headers.accept?.includes("vnd.pgrst.object")) {
    if (!rows.length) return reply(406, {code:"PGRST116",details:"The result contains 0 rows"});
    return reply(200, rows[0]);
  }
  return reply(200, rows);
}
