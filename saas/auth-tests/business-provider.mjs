// PostgREST double for route tests. Tenant isolation must come from the route's filters.
import { randomUUID } from "node:crypto";
const tables = new Map([["prospects", new Map()], ["quote_requests", new Map()], ["followups", new Map()]]);

export function businessReply(request, url, input, reply) {
  const table = tables.get(url.pathname.split("/").pop());
  if (!table) return reply(404, {});
  const params = url.searchParams;
  const method = request.method;
  let rows = [...table.values()].filter(row =>
    ["company_id", "id"].every(key => {
      const filter = params.get(key);
      if (!filter) return true;
      if (filter.startsWith("gt.")) return row[key] > filter.slice(3);
      return filter === "eq." + row[key];
    }));
  if (method === "POST") {
    const row = { id: randomUUID(), created_at: new Date().toISOString(), ...input };
    table.set(row.id, row);
    rows = [row];
  } else if (method === "PATCH") {
    for (const row of rows) Object.assign(row, input);
  } else if (method === "DELETE") {
    for (const row of rows) table.delete(row.id);
  }
  if (params.get("order") === "id.asc") rows.sort((a,b) => a.id.localeCompare(b.id));
  if (params.has("limit")) rows = rows.slice(0, Number(params.get("limit")));
  if (request.headers.accept?.includes("vnd.pgrst.object")) {
    if (!rows.length) return reply(406, {code:"PGRST116",details:"The result contains 0 rows"});
    return reply(200, rows[0]);
  }
  return reply(200, rows);
}
