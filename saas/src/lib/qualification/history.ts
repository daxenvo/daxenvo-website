import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { creerServiceQualification } from "../../../../j6/service.server.mjs";
import { ApiError, businessAccess, businessError, checkDatabase } from "@/lib/business/api";
import { responseSession } from "@/lib/supabase/response";
import { qualificationSchema } from "@/lib/domain/models";

const analyse = creerServiceQualification({ fournisseur: null });
const sourceSchema = z.object({
  description: z.string(), project_type: z.string(), city: z.string(),
  budget: z.number().nonnegative(), requested_timeline: z.string(),
});
const resultSchema = qualificationSchema.extend({
  version: z.literal("j6-regles-v1"), fournisseur: z.null(),
  repli: z.strictObject({code: z.literal("IA_NON_CONFIGUREE")}),
  signaux: z.array(z.string()).max(3),
}).strict();
const positive = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number);
const page = z.strictObject({
  before: positive.pipe(z.number().max(2147483647)).optional(),
  limit: positive.pipe(z.number().max(100)).optional(),
});
const columns = "id,company_id,request_id,revision,created_at,created_by,result";

export async function qualifications(request: NextRequest, id: string, latest = false) {
  const session = responseSession(request);
  const json = (value: unknown, status = 200) => session.finish(NextResponse.json(value, {status}));
  try {
    const {client, active} = await businessAccess(request, session);
    const company = active.company_id;
    z.uuid().parse(id);
    const write = request.method === "POST";
    const params = request.nextUrl.searchParams;
    if (((write || latest) && params.size) || [...params.keys()].some(key => params.getAll(key).length !== 1))
      throw new ApiError(400, "INVALID_QUERY");
    const {before, limit = 25} = page.parse(Object.fromEntries(params));
    if (write && request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (chunk.value.byteLength > 0) {
            await reader.cancel();
            throw new ApiError(400, "EMPTY_BODY_REQUIRED");
          }
        }
      } finally { reader.releaseLock(); }
    }

    const sourceColumns = "description,project_type,city,budget,requested_timeline";
    const row = await client.from("quote_requests").select(write ? sourceColumns : "id")
      .eq("company_id", company).eq("id", id).maybeSingle();
    checkDatabase(row.error, row.status);
    if (!row.data) throw new ApiError(404, "NOT_FOUND");

    if (write) {
      const writer = process.env.QUALIFICATION_WRITER_TOKEN;
      if (!writer || !/^[a-f0-9]{64}$/.test(writer)) throw new ApiError(503, "NOT_CONFIGURED");
      const parsed = sourceSchema.safeParse(row.data);
      if (!parsed.success) throw new ApiError(503, "UNAVAILABLE");
      const source = parsed.data;
      const result = resultSchema.safeParse(await analyse({
        description: source.description, typeTravaux: source.project_type, ville: source.city,
        ...(source.budget > 0 ? { budget: String(source.budget) } : {}),
        delai: source.requested_timeline,
      }, { tenantId: company }));
      if (!result.success) throw new ApiError(503, "UNAVAILABLE");
      const saved = await client.rpc("record_request_qualification", {
        p_company: company, p_request: id, p_source: source, p_result: result.data, p_writer: writer,
      }).single();
      if (saved.error?.code === "P0002") throw new ApiError(404, "NOT_FOUND");
      if (saved.error?.code === "40001") throw new ApiError(409, "SOURCE_CHANGED");
      checkDatabase(saved.error, saved.status);
      if (!saved.data) throw new ApiError(503, "UNAVAILABLE");
      return json({data: saved.data}, 201);
    }

    let query = client.from("request_qualifications").select(columns)
      .eq("company_id", company).eq("request_id", id).order("revision", {ascending: false})
      .limit(latest ? 1 : limit + 1);
    if (before) query = query.lt("revision", before);
    const history = await query;
    checkDatabase(history.error, history.status);
    if (!Array.isArray(history.data)) throw new ApiError(503, "UNAVAILABLE");
    if (latest) {
      if (!history.data.length) throw new ApiError(404, "NOT_FOUND");
      return json({data: history.data[0]});
    }
    return json({data: history.data.slice(0, limit),
      nextCursor: history.data.length > limit ? history.data[limit - 1].revision : null});
  } catch (error) { return businessError(error, json); }
}
