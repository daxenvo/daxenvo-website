import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, businessAccess, businessError, checkDatabase, readBody } from "@/lib/business/api";
import { responseSession } from "@/lib/supabase/response";

const policy = z.strictObject({
  delay_hours: z.int().min(1).max(8760),
  urgent_hours: z.int().min(1).max(8760),
  max_attempts: z.int().min(0).max(20),
  batch_size: z.int().min(1).max(100),
});
const operation = z.uuid();
const event = z.discriminatedUnion("kind", [
  z.strictObject({ operation, kind: z.literal("delay"), value: z.iso.datetime({offset:true}) }),
  z.strictObject({ operation, kind: z.literal("preference"), value: z.enum(["email","sms","phone"]) }),
  z.strictObject({ operation, kind: z.enum(["contact","interested","information","appointment","refused","opt_out","human","pause","resume"]) }),
]);

export async function automation(request: NextRequest, id?: string) {
  const session = responseSession(request);
  const json = (value: unknown, status = 200) => session.finish(NextResponse.json(value, {status}));
  try {
    const {client,active} = await businessAccess(request,session);
    const tenant = active.company_id;
    const params = request.nextUrl.searchParams;
    let result;
    if (request.method === "GET" || request.method === "HEAD") {
      const target = z.uuid().parse(id);
      if ([...params.keys()].some(k => k !== "before" || params.getAll(k).length !== 1))
        throw new ApiError(400,"INVALID_QUERY");
      const before = z.string().regex(/^[1-9]\d{0,17}$/).nullable().parse(params.get("before"));
      result = await client.rpc("followup_automation_status",{tenant,target,before_id:before});
    } else {
      if (params.size) throw new ApiError(400,"INVALID_QUERY");
      if (id === undefined) {
        if (active.role === "member") throw new ApiError(403,"FORBIDDEN");
        const settings = policy.parse(await readBody(request));
        result = await client.rpc("configure_followup_automation",{tenant,...settings});
      } else {
        const target = z.uuid().parse(id);
        const input = event.parse(await readBody(request));
        if (active.role === "member" && ["preference","resume"].includes(input.kind))
          throw new ApiError(403,"FORBIDDEN");
        result = await client.rpc("followup_automation_event",{tenant,target,...input});
      }
    }
    const code = result.error?.code;
    if (code === "P0002") throw new ApiError(404,"NOT_FOUND");
    if (code === "PT409") throw new ApiError(409,"EVENT_CONFLICT");
    if (["22023","22007","22008","23514"].includes(code ?? "")) throw new ApiError(400,"INVALID_INPUT");
    checkDatabase(result.error,result.status);
    return result.data === null ? session.finish(new NextResponse(null,{status:204})) : json(result.data);
  } catch (error) {
    return businessError(error,json);
  }
}
