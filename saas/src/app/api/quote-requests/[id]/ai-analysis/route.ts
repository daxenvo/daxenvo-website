import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, businessAccess, businessError, checkDatabase, readBody } from "@/lib/business/api";
import { responseSession } from "@/lib/supabase/response";
import { analyze, sourceSchema } from "@/lib/ai/analysis.server";
import { simulatedLedger } from "@/lib/ai/ledger";

export const runtime = "nodejs";
export async function POST(request:NextRequest, context:{params:Promise<{id:string}>}) {
  const session=responseSession(request);
  const json=(body:unknown,status=200)=>session.finish(NextResponse.json(body,{status}));
  try {
    const {client,user,active}=await businessAccess(request,session);
    const id=z.uuid().parse((await context.params).id);
    if(request.nextUrl.searchParams.size) throw new ApiError(400,"INVALID_QUERY");
    const {operation}=z.strictObject({operation:z.uuid()}).parse(await readBody(request));
    const row=await client.from("quote_requests").select("description,project_type,city,budget,requested_timeline")
      .eq("company_id",active.company_id).eq("id",id).maybeSingle();
    checkDatabase(row.error,row.status);
    if(!row.data) throw new ApiError(404,"NOT_FOUND");
    const ledger=simulatedLedger();
    if(!ledger) throw new ApiError(503,"NOT_CONFIGURED");
    const source=sourceSchema.safeParse(row.data);
    if(!source.success) throw new ApiError(503,"UNAVAILABLE");
    const result=await analyze({company:active.company_id,actor:user.id,request:id,operation},source.data,ledger);
    if(result.error) {
      const statuses={NOT_FOUND:404,NOT_CONFIGURED:503,SOURCE_CHANGED:409,CONFLICT:409,INPUT_LIMIT:413,
        ATTEMPT_LIMIT:429,QUOTA_LIMIT:429,BUDGET_LIMIT:429};
      throw new ApiError(statuses[result.error],result.error);
    }
    return json(result);
  } catch(error) { return businessError(error,json); }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = responseSession(request);
  const json = (body: unknown, status = 200) => session.finish(NextResponse.json(body, {status}));
  try {
    const {client, active} = await businessAccess(request, session);
    const id = z.uuid().parse((await context.params).id);
    const params = request.nextUrl.searchParams;
    if (params.size !== new Set(params.keys()).size) throw new ApiError(400, "INVALID_QUERY");
    const {before} = z.strictObject({
      before: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(z.number().max(2147483647)).optional(),
    }).parse(Object.fromEntries(params));
    const requestRow = await client.from("quote_requests").select("id")
      .eq("company_id", active.company_id).eq("id", id).maybeSingle();
    checkDatabase(requestRow.error, requestRow.status);
    if (!requestRow.data) throw new ApiError(404, "NOT_FOUND");
    const limit = 10;
    let query = client.from("request_ai_qualifications")
      .select("operation,revision,created_at,created_by,model,prompt_version,outcome,result")
      .eq("company_id", active.company_id).eq("request_id", id).order("revision", {ascending:false}).limit(limit+1);
    if (before) query = query.lt("revision", before);
    const history = await query;
    checkDatabase(history.error, history.status);
    if (!Array.isArray(history.data)) throw new ApiError(503, "UNAVAILABLE");
    return json({data:history.data.slice(0,limit), nextCursor:history.data.length>limit ? history.data[limit-1].revision : null});
  } catch (error) { return businessError(error, json); }
}
