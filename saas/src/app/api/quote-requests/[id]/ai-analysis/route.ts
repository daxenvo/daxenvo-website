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
