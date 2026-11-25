import "server-only";
import {createHash, createHmac, randomUUID} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,businessAccess,businessError,checkDatabase,readBody} from "@/lib/business/api";
import {responseSession} from "@/lib/supabase/response";
import {CalendarError,Calendly,type CalendarProvider,type Observation,type Slot} from "./provider";

const id=z.uuid();
const instant=z.iso.datetime({offset:true}).transform(value=>new Date(value).toISOString());
const zone=z.string().min(1).max(80).refine(value=>{
  try {new Intl.DateTimeFormat("fr",{timeZone:value});return true} catch {return false}
});
const actions=z.discriminatedUnion("action",[
  z.strictObject({action:z.literal("availability"),from:instant,to:instant,zone}),
  z.strictObject({action:z.literal("propose"),operation:id,start:instant,title:z.string().trim().min(2).max(160),zone}),
  z.strictObject({action:z.literal("reserve"),id,name:z.string().trim().min(1).max(120),email:z.email().max(254)}),
  z.strictObject({action:z.enum(["cancel","reschedule","sync","recover"]),id}),
]);
const credentials=z.object({host:id,eventType:id,token:z.string().min(1),writer:z.string().regex(/^[0-9a-f]{64}$/)});
function connection(tenant:string) {
  try {
    const all=z.record(id,credentials).parse(JSON.parse(process.env.BOOKING_CALENDARS_JSON??"{}"));
    const tenants=Object.values(all);
    // Never allow two tenants to resolve to the same host, credential or event type.
    for(const key of ["host","eventType","token","writer"] as const) {
      if(new Set(tenants.map(c=>c[key])).size!==tenants.length) throw new Error();
    }
    if(all[tenant]) return all[tenant];
  } catch { /* Configuration errors must not expose secrets or other tenant IDs. */ }
  throw new ApiError(503,"CALENDAR_NOT_CONFIGURED");
}
const stored=z.object({
  id,company_id:id,request_id:id,state:z.enum(["proposed","pending","confirmed","cancelled","error"]),
  starts_at:z.string(),duration_minutes:z.number(),zone:z.string(),title:z.string(),reference:z.string().nullable(),
  revision:z.number(),invitee_hash:z.string().nullable(),retry_at:z.string().nullable(),last_error:z.string().nullable(),
  cancel_requested:z.boolean(),rejected:z.boolean(),
});
type Booking=z.infer<typeof stored>;
function visible(b:Booking) {
  return {id:b.id,request_id:b.request_id,title:b.title,status:b.state,start:b.starts_at,minutes:b.duration_minutes,
    zone:b.zone,reference:b.reference,retry_at:b.retry_at,error:b.last_error,cancellation_requested:b.cancel_requested};
}
const result=z.object({booking:stored,dispatch:z.boolean()});
type Command=(command:string,fields:Record<string,unknown>)=>Promise<unknown>;
async function slots(provider:CalendarProvider,command:Command,from:string,to:string) {
  const horizon=Date.parse(to)-Date.parse(from);
  if(Date.parse(from)<=Date.now() || horizon<=0 || horizon>7*86400000) throw new ApiError(400,"INVALID_WINDOW");
  const busy=z.array(z.object({starts_at:z.string(),duration_minutes:z.number()})).parse(await command("availability",{from,to}));
  let available:Slot[];
  try {available=await provider.slots(from,to)} catch(e) {
    if(e instanceof CalendarError && e.status===429) await command("cooldown",{delay:e.retryAfter});
    throw e instanceof CalendarError?e:new CalendarError("INVALID_PROVIDER_RESPONSE");
  }
  return available.filter(s=>Date.parse(s.start)>=Date.parse(from)&&Date.parse(s.start)<Date.parse(to)&&
    !busy.some(b=>Date.parse(b.starts_at)<Date.parse(s.start)+s.minutes*60000 && Date.parse(s.start)<Date.parse(b.starts_at)+b.duration_minutes*60000));
}
export async function bookingApi(request:NextRequest,requestId:string) {
  const session=responseSession(request);
  const json=(value:unknown,status=200)=>session.finish(NextResponse.json(value,{status}));
  try {
    const {client,active,user}=await businessAccess(request,session);
    id.parse(requestId);
    const tenant=active.company_id;
    const target=await client.from("quote_requests").select("id").eq("company_id",tenant).eq("id",requestId).maybeSingle();
    checkDatabase(target.error,target.status);
    if(!target.data) throw new ApiError(404,"NOT_FOUND");
    const config=connection(tenant);
    const provider:CalendarProvider=new Calendly(config);
    const writer=createHash("sha256").update(config.writer).digest();
    const emailHash=(email:string)=>createHmac("sha256",writer).update("invitee:"+email.trim().toLowerCase()).digest("hex");
    const command:Command=async(cmd,fields)=>{
      const message=JSON.stringify({purpose:"booking.v1",nonce:randomUUID(),actor:user.id,company:tenant,request:requestId,binding:config.eventType,
        command:cmd,fields,expires:Math.floor(Date.now()/1000)+45});
      const signature=createHmac("sha256",writer).update(message).digest("hex");
      const r=await client.rpc("booking_command",{message,signature});
      if(r.error && ["PT404","PT409","PT429","PT503"].includes(r.error.code)) throw new ApiError(Number(r.error.code.slice(2)),r.error.message);
      checkDatabase(r.error,r.status);
      return r.data;
    };
    const params=request.nextUrl.searchParams;
    if(request.method==="GET" || request.method==="HEAD") {
      if([...params.keys()].some(k=>k!=="after"||params.getAll(k).length!==1)) throw new ApiError(400,"INVALID_QUERY");
      const after=id.nullable().parse(params.get("after"));
      const rows=z.array(stored).parse(await command("list",{after}));
      return json({data:rows.map(visible),nextCursor:rows.length===25?rows.at(-1)?.id:null});
    }
    if(params.size) throw new ApiError(400,"INVALID_QUERY");
    const input=actions.parse(await readBody(request));
    if(input.action==="availability") {
      const data=await slots(provider,command,input.from,input.to);
      return json({data,zone:input.zone});
    }
    if(input.action==="propose") {
      const prior=stored.nullable().parse(await command("proposal",input));
      if(prior) return json({data:visible(prior)});
      const at=Date.parse(input.start);
      const data=await slots(provider,command,new Date(Math.max(Date.now()+1000,at-60000)).toISOString(),new Date(at+60000).toISOString());
      const slot=data.find(s=>s.start===input.start);
      if(!slot) throw new ApiError(409,"SLOT_UNAVAILABLE");
      return json({data:visible(result.parse(await command("propose",{...input,minutes:slot.minutes})).booking)},201);
    }
    if(active.role==="member"&&["cancel","reschedule","recover"].includes(input.action)) throw new ApiError(403,"FORBIDDEN");
    const claim=result.parse(await command(input.action,{id:input.id,...(input.action==="reserve"?{invitee_hash:emailHash(input.email)}:{})}));
    const b=claim.booking;
    if((input.action==="reserve"&&!claim.dispatch)||(!b.reference&&b.state==="cancelled"))
      return json({data:visible(b)},b.state==="pending"?202:200);
    const matchesEmail=(email:string)=>emailHash(email)===b.invitee_hash;
    let observation:Observation;
    let rejected=false;
    try {
      let ref=b.reference;
      if(input.action==="reserve") {
        try {ref=await provider.reserve(b.id,{start:new Date(b.starts_at).toISOString(),minutes:b.duration_minutes},
          {name:input.name,email:input.email,zone:b.zone})} catch(e) {rejected=e instanceof CalendarError && e.rejected;throw e}
      }
      if(!ref) ref=await provider.discover(b.id,b.starts_at);
      if(!ref) throw new CalendarError("RECONCILIATION_REQUIRED");
      observation=await provider.observe(b.id,ref,ref===b.reference,matchesEmail);
      if(input.action==="cancel"&&claim.dispatch&&observation.status==="confirmed") {
        // Cancel only the exact event that was current when this manager claimed the operation.
        if(observation.reference!==ref) throw new CalendarError("BOOKING_CHANGED",409);
        await provider.cancel(ref);
        observation=await provider.observe(b.id,ref,true,matchesEmail);
      }
    } catch(e) {
      const failure=e instanceof CalendarError?e:new CalendarError("INVALID_PROVIDER_RESPONSE");
      await command("failure",{id:b.id,revision:b.revision,error:failure.message,delay:failure.retryAfter,rejected});
      throw failure;
    }
    const saved=result.parse(await command("observe",{id:b.id,revision:b.revision,recovery:input.action==="recover",...observation}));
    const link=input.action==="reschedule"&&saved.booking.reference===observation.reference&&saved.booking.state==="confirmed"?observation.reschedule:null;
    return json({data:visible(saved.booking),...(link?{reschedule_url:link}:{})});
  } catch(e) {
    if(e instanceof CalendarError) {
      const response=json({error:e.message},e.status);
      if(e.status===429) response.headers.set("Retry-After",String(e.retryAfter));
      return response;
    }
    return businessError(e,json);
  }
}
