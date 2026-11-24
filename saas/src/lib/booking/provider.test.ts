import {test} from "node:test";
import assert from "node:assert/strict";
import {Calendly} from "./provider.ts";

const host="10000000-0000-4000-8000-000000000001", eventType="20000000-0000-4000-8000-000000000001";
const base="https://api.calendly.com", type=base+"/event_types/"+eventType, meeting=base+"/scheduled_events/one";
const start="2027-03-28T01:30:00.000Z", end="2027-03-28T02:00:00.000Z", ref=meeting+"/invitees/one";
const guest={uri:ref,event:meeting,status:"active",updated_at:start,tracking:{utm_content:"op"},new_invitee:null,reschedule_url:"https://calendly.com/reschedulings/one"};
const appointment={uri:meeting,event_type:type,event_memberships:[{user:base+"/users/"+host}],start_time:start,end_time:end,updated_at:start,status:"active"};
const info={uri:type,active:true,kind:"solo",profile:{owner:base+"/users/"+host},duration:30,is_paid:false,locations:[{kind:"google_conference"}],custom_questions:[]};
function adapter(handler:(url:string,opts?:RequestInit)=>unknown) {
  return new Calendly({host,eventType,token:"fixture"},async(url,opts)=>{
    assert.equal(opts?.redirect,"error");
    const value=handler(String(url),opts);
    return value instanceof Response?value:Response.json(value);
  });
}
test("créneaux UTC et passage à l’heure d’été",async()=>{
  const p=adapter(url=>url===type?{resource:info}:{collection:[{start_time:"2027-03-28T03:30:00+02:00",status:"available",invitees_remaining:1}]});
  assert.deepEqual(await p.slots(start,end),[{start,minutes:30}]);
});
test("création corrélée puis confirmation par lecture Calendly",async()=>{
  const p=adapter((url,o)=>{
    if(url===type)return {resource:info};
    if(url.endsWith("/invitees")) {const body=JSON.parse(String(o?.body));assert.equal(body.tracking.utm_content,"op");assert.equal(body.invitee.timezone,"Europe/Paris");}
    return {resource:url===meeting?appointment:guest};
  });
  assert.equal(await p.reserve("op",{start,minutes:30},{name:"Fixture",email:"fixture@example.invalid",zone:"Europe/Paris"}),ref);
  assert.equal((await p.observe("op",ref,false)).status,"confirmed");
});
test("lecture externe hors entreprise ou non corrélée refusée",async()=>{
  const p=adapter(url=>({resource:url===meeting?appointment:guest}));
  await assert.rejects(p.observe("other",ref,false),/UNRELATED/);
  await assert.rejects(p.observe("op","https://example.invalid/secret",true),/REFERENCE/);
  await assert.rejects(adapter(url=>({resource:url===meeting?{...appointment,event_type:"other"}:guest})).observe("op",ref,true),/UNRELATED/);
});
test("replanification, annulation et reprise sur limite fournisseur",async()=>{
  const newer=meeting+"/invitees/two";
  const p=adapter(url=>({resource:url===ref?{...guest,new_invitee:newer}:url===newer?{...guest,uri:newer,status:"canceled",tracking:null}:appointment}));
  const result=await p.observe("op",ref,true);
  assert.equal(result.reference,newer);assert.equal(result.status,"cancelled");
  await assert.rejects(adapter(()=>new Response(null,{status:429,headers:{"Retry-After":"300"}})).slots(start,end),{message:"CALENDAR_RATE_LIMIT",retryAfter:300});
});
test("réconciliation après réponse perdue sans rejouer la création",async()=>{
  const p=adapter((url,opts)=>{assert.equal(opts?.method,"GET");return {collection:url.includes("/invitees?")?[guest]:[appointment]}});
  assert.equal(await p.discover("op",start),ref);
  assert.equal(await p.discover("other",start),null);
});
