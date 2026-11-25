import { z } from "zod";

export type Slot = { start: string; minutes: number };
export type Observation = Slot & {
  reference: string; status: "confirmed" | "cancelled"; updated: string; reschedule: string | null;
};
export interface CalendarProvider {
  slots(from: string, to: string): Promise<Slot[]>;
  reserve(id: string, slot: Slot, person: {name:string; email:string; zone:string}): Promise<string>;
  observe(id: string, reference: string, linked: boolean, matchesEmail: (email:string)=>boolean): Promise<Observation>;
  discover(id: string, start: string): Promise<string | null>;
  cancel(reference: string): Promise<void>;
}

export class CalendarError extends Error {
  readonly status: number;
  readonly retryAfter: number;
  readonly rejected: boolean;
  constructor(code: string, status = 503, retryAfter = 60, rejected = false) {
    super(code);
    this.rejected = rejected;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const base = "https://api.calendly.com";
const instant = z.iso.datetime({offset:true});
const referencePattern = /^https:\/\/api\.calendly\.com(\/scheduled_events\/[a-zA-Z0-9-]+\/invitees\/[a-zA-Z0-9-]+)$/;
function inviteePath(uri: string) {
  const match = referencePattern.exec(uri);
  if (!match) throw new CalendarError("INVALID_PROVIDER_REFERENCE");
  return match[1];
}
const event = z.object({
  uri:z.string(), event_type:z.string(), event_memberships:z.array(z.object({user:z.string()})),
  start_time:instant, end_time:instant, updated_at:instant, status:z.enum(["active","canceled"]),
});
const invitee = z.object({
  uri:z.string(), email:z.email(), event:z.string(), status:z.enum(["active","canceled"]), updated_at:instant,
  tracking:z.object({utm_content:z.string().nullable()}).nullable(), new_invitee:z.string().nullable(),
  reschedule_url:z.string().nullable(),
});

type Operation = "get_event_type" | "list_slots" | "create_invitee" | "get_invitee" |
  "get_event" | "list_events" | "list_invitees" | "cancel_event";

// Only closed vocabularies reach server logs. Error messages and parameter values
// can contain invitee data, credentials or provider URLs.
const titles = new Set(["Invalid Argument", "Deprecated", "Unauthenticated", "Permission Denied",
  "Insufficient scope", "Resource Not Found", "Internal Server Error", "Too Many Requests"]);
const codes = new Set(["invalid", "invalid_value", "invalid_grant", "invalid_token", "insufficient_scope",
  "required", "blank", "not_found", "already_taken", "slot_unavailable", "rate_limit_exceeded"]);
const parameters = new Set(["event_type", "start_time", "invitee", "invitee.name", "invitee.email",
  "invitee.timezone", "location", "location.kind", "questions_and_answers", "tracking", "tracking.utm_content"]);
const reasons = new Map([
  ["Specified location kind is not configured for this event type.", "location_not_configured"],
  ["Required Questions and Answers cannot be blank.", "required_answers_missing"],
  ["Event types that require payment cannot be scheduled via the API.", "paid_event_type"],
  ["The access token expired", "token_expired"],
  ["The access token was revoked", "token_revoked"],
  ["Please upgrade to a paid Calendly account.", "plan_restriction"],
]);

async function errorFields(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return {};
      }
      chunks.push(value);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const details = Array.isArray(payload?.details) ? payload.details.slice(0, 4) : [];
    return {
      title: titles.has(payload?.title) ? payload.title : undefined,
      code: codes.has(payload?.code) ? payload.code : undefined,
      reason: reasons.get(payload?.message),
      details: details.map((detail: {code?: string; parameter?: string} | null) => ({
        code: detail?.code && codes.has(detail.code) ? detail.code : undefined,
        parameter: detail?.parameter && parameters.has(detail.parameter) ? detail.parameter : undefined,
      })).filter((detail: {code?: string; parameter?: string}) => detail.code || detail.parameter),
    };
  } catch {
    return {};
  } finally {
    reader.releaseLock();
  }
}

export class Calendly implements CalendarProvider {
  private host: string;
  private type: string;
  private token: string;
  private transport: typeof fetch;
  constructor(config:{host:string; eventType:string; token:string}, transport:typeof fetch=fetch) {
    this.host=base+"/users/"+z.uuid().parse(config.host);
    this.type=base+"/event_types/"+z.uuid().parse(config.eventType);
    this.token=config.token;
    this.transport=transport;
  }
  private async api(operation:Operation, path:string, body?:unknown) {
    const response=await this.transport(base+path,{
      headers:{Authorization:"Bearer "+this.token,"Content-Type":"application/json"},
      method:body===undefined?"GET":"POST", body:body===undefined?undefined:JSON.stringify(body),
      redirect:"error", cache:"no-store", signal:AbortSignal.timeout(8000),
    }).catch(()=>{
      console.warn("calendly.failure", {operation, httpStatus:null, reason:"transport_failure"});
      throw new CalendarError("CALENDAR_UNAVAILABLE");
    });
    if (!response.ok) {
      console.warn("calendly.failure", {operation, httpStatus:response.status, ...await errorFields(response)});
    }
    if(response.status===429) {
      const retry=Number(response.headers.get("Retry-After"));
      throw new CalendarError("CALENDAR_RATE_LIMIT",429,Number.isFinite(retry)?Math.max(60,Math.min(86400,retry)):60,true);
    }
    if(!response.ok) throw new CalendarError(response.status===409?"SLOT_UNAVAILABLE":"CALENDAR_REJECTED",response.status===409?409:503,60,[400,401,403,404,409,422].includes(response.status));
    if (response.status===204) return {};
    try {
      return await response.json();
    } catch {
      console.warn("calendly.failure", {operation, httpStatus:response.status, reason:"invalid_json"});
      throw new CalendarError("INVALID_PROVIDER_RESPONSE");
    }
  }
  private async typeInfo() {
    const info=z.object({uri:z.string(),active:z.boolean(),kind:z.string(),duration:z.number().int().min(15).max(240),
      profile:z.object({owner:z.string()}),is_paid:z.boolean(),locations:z.array(z.object({kind:z.string()})).nullable(),
      custom_questions:z.array(z.object({enabled:z.boolean(),required:z.boolean()})),
    }).parse((await this.api("get_event_type", this.type.slice(base.length))).resource);
    if(info.uri!==this.type || info.profile.owner!==this.host || !info.active || info.kind!=="solo" ||
       info.is_paid || info.custom_questions.some(q=>q.enabled&&q.required) || (info.locations?.length??0)>1 ||
       info.locations?.some(l=>l.kind!=="google_conference")) throw new CalendarError("UNSUPPORTED_EVENT_TYPE");
    return info;
  }
  async slots(from:string,to:string):Promise<Slot[]> {
    const info=await this.typeInfo();
    const params=new URLSearchParams({event_type:this.type,start_time:from,end_time:to});
    const slots=z.array(z.object({status:z.string(),invitees_remaining:z.number(),start_time:instant}))
      .parse((await this.api("list_slots", "/event_type_available_times?"+params)).collection);
    return slots.filter(s=>s.status==="available"&&s.invitees_remaining>0)
      .map(s=>({start:new Date(s.start_time).toISOString(),minutes:info.duration}));
  }
  async reserve(id:string,slot:Slot,person:{name:string;email:string;zone:string}) {
    const info=await this.typeInfo();
    if(info.duration!==slot.minutes) throw new CalendarError("SLOT_CHANGED",409);
    const body={event_type:this.type,start_time:slot.start,invitee:{name:person.name,email:person.email,timezone:person.zone},
      ...(info.locations?.length?{location:{kind:info.locations[0].kind}}:{}),tracking:{
        utm_content:id,utm_source:null,utm_campaign:null,utm_medium:null,utm_term:null,salesforce_uuid:null,
      }};
    const resource=invitee.parse((await this.api("create_invitee", "/invitees",body)).resource);
    if(resource.tracking?.utm_content!==id) throw new CalendarError("BOOKING_UNCERTAIN");
    inviteePath(resource.uri);
    return resource.uri;
  }
  async observe(id:string,reference:string,linked:boolean,matchesEmail:(email:string)=>boolean):Promise<Observation> {
    // Follow only provider-returned successor links from an already verified predecessor.
    for(let depth=0;depth<4;depth++) {
      const path=inviteePath(reference), eventPath=path.split("/invitees/")[0];
      const [i,e]=await Promise.all([this.api("get_invitee", path),this.api("get_event", eventPath)]);
      const guest=invitee.parse(i.resource), meeting=event.parse(e.resource);
      if(!matchesEmail(guest.email) || guest.uri!==reference || guest.event!==base+eventPath || meeting.uri!==guest.event ||
        meeting.event_type!==this.type || !meeting.event_memberships.some(m=>m.user===this.host) ||
        (!linked && guest.tracking?.utm_content!==id)) throw new CalendarError("UNRELATED_BOOKING",404);
      if(guest.new_invitee) {reference=guest.new_invitee;linked=true;continue}
      const minutes=(Date.parse(meeting.end_time)-Date.parse(meeting.start_time))/60000;
      if(!Number.isInteger(minutes)||minutes<15||minutes>240) throw new CalendarError("INVALID_DURATION");
      const reschedule=guest.reschedule_url && /^https:\/\/calendly\.com\/reschedulings\/[a-zA-Z0-9-]+$/.test(guest.reschedule_url)?guest.reschedule_url:null;
      return {reference,minutes,start:new Date(meeting.start_time).toISOString(),
        status:guest.status==="canceled"||meeting.status==="canceled"?"cancelled":"confirmed",
        updated:new Date(Math.max(Date.parse(guest.updated_at),Date.parse(meeting.updated_at))).toISOString(),reschedule};
    }
    throw new CalendarError("RECONCILIATION_REQUIRED");
  }
  async discover(id:string,start:string) {
    const t=Date.parse(start);
    const params=new URLSearchParams({user:this.host,min_start_time:new Date(t-1000).toISOString(),max_start_time:new Date(t+1000).toISOString(),count:"10"});
    const page=await this.api("list_events", "/scheduled_events?"+params);
    if(page.pagination?.next_page_token) throw new CalendarError("RECONCILIATION_REQUIRED");
    let found:string|null=null;
    for(const item of z.array(event).max(10).parse(page.collection)) {
      if(item.event_type!==this.type || !item.event_memberships.some(m=>m.user===this.host)) continue;
      const path=inviteePath(item.uri+"/invitees/probe").split("/invitees/")[0];
      const guests=await this.api("list_invitees", path+"/invitees?count=100");
      if(guests.pagination?.next_page_token) throw new CalendarError("RECONCILIATION_REQUIRED");
      for(const g of z.array(invitee).parse(guests.collection)) if(g.tracking?.utm_content===id) {
        if(found) throw new CalendarError("AMBIGUOUS_BOOKING");
        found=g.uri;
      }
    }
    return found;
  }
  async cancel(reference:string) {
    await this.api("cancel_event", inviteePath(reference).split("/invitees/")[0]+"/cancellation",{reason:"Annulation demandée via Daxenvo"});
  }
}
