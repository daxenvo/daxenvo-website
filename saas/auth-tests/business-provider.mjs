// PostgREST double for route tests. Tenant isolation must come from the route's filters.
import { createHash, createHmac, randomUUID } from "node:crypto";
const tables = new Map([["prospects", new Map()], ["quote_requests", new Map()], ["followups", new Map()], ["appointments", new Map()], ["request_qualifications", new Map()], ["request_ai_qualifications", new Map()]]);

const nextQualificationError = new Map();

export function businessReply(request, url, input, reply, actor) {
  if (request.method === "POST" && url.pathname === "/rest/v1/test/next-qualification-error") {
    nextQualificationError.set(input.requestId, input.response);
    return reply(200, {});
  }
  if (url.pathname === "/rest/v1/rpc/client_dashboard") {
    const scoped = name => [...tables.get(name).values()].filter(r => r.company_id === input.tenant);
    const prospects = scoped("prospects"), requests = scoped("quote_requests");
    if (input.panel === "synthese") return reply(200, {
      prospects:prospects.length, new:requests.filter(r=>r.status==="nouvelle").length,
      open:requests.filter(r=>["nouvelle","a_qualifier"].includes(r.status)).length, priority:0,
      scheduled:0, attention:0, confirmed:0, won:requests.filter(r=>r.status==="gagnee").length, lost:requests.filter(r=>r.status==="perdue").length,
    });
    if (input.panel === "activite") return reply(200,requests.map(r=>({
      request_id:r.id, stamp:r.created_at, kind:"demande", key:r.id, title:r.title, detail:"",
    })).sort((a,b)=>b.stamp.localeCompare(a.stamp)).slice(0,20));
    if (input.panel === "parametres") return reply(200,{calendar:false,policy:null});
    const rows=input.panel==="prospects"?prospects.map(p=>({key:p.id,id:p.id,request_id:null,title:p.name,detail:p.city,state:p.sector,
      stamp:null,priority:null,reason:null})):input.panel==="demandes"?requests.filter(r=>!input.related||r.prospect_id===input.related).map(r=>({
      key:r.id,id:r.id,request_id:r.id,title:r.title,detail:"",state:r.status,stamp:r.created_at,priority:null,reason:null,
    })):[];
    return reply(200,rows.filter(r=>r.key>input.cursor_key && (!input.facet||r.state===input.facet) &&
      (r.title+" "+r.detail).toLowerCase().includes(input.term.toLowerCase())).sort((a,b)=>a.key.localeCompare(b.key)).slice(0,26));
  }
  if (url.pathname === "/rest/v1/rpc/record_request_qualification") {
    const key = createHash("sha256").update(process.env.QUALIFICATION_WRITER_TOKEN).digest();
    if (createHmac("sha256", key).update(input.p_message).digest("hex") !== input.p_signature)
      return reply(403, {code: "42501"});
    const {company: p_company, request: p_request, result: p_result, actor: signer} = JSON.parse(input.p_message);
    if (signer !== actor) return reply(403, {code: "42501"});
    const row = tables.get("quote_requests").get(p_request);
    if (!row || row.company_id !== p_company) return reply(404, {code: "P0002"});
    const failure = nextQualificationError.get(p_request);
    if (failure) {
      nextQualificationError.delete(p_request);
      return reply(failure.status, failure.body);
    }
    const history = tables.get("request_qualifications");
    const revision = 1 + [...history.values()].filter(h => h.request_id === p_request).length;
    const saved = {id: randomUUID(), company_id: p_company, request_id: p_request,
      revision, created_by: actor, created_at: new Date().toISOString(), result: p_result};
    history.set(saved.id, saved);
    return reply(200, saved);
  }
  if (url.pathname === "/rest/v1/rpc/followup_automation_status") {
    const row = tables.get("quote_requests").get(input.target);
    if (!row || row.company_id !== input.tenant) return reply(404, {code:"P0002"});
    return reply(200,{job:{company_id:row.company_id,request_id:row.id},history:[]});
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
