import {test} from "node:test";
import assert from "node:assert/strict";
import {Calendly} from "./provider.ts";

const host="10000000-0000-4000-8000-000000000001", eventType="20000000-0000-4000-8000-000000000001";
const base="https://api.calendly.com", type=base+"/event_types/"+eventType, meeting=base+"/scheduled_events/one";
const start="2027-03-28T01:30:00.000Z", end="2027-03-28T02:00:00.000Z", ref=meeting+"/invitees/one";
const guest={uri:ref,email:"fixture@example.invalid",event:meeting,status:"active",updated_at:start,tracking:{utm_content:"op"},new_invitee:null,reschedule_url:"https://calendly.com/reschedulings/one"};
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
    if(url.endsWith("/invitees")) {const body=JSON.parse(String(o?.body));assert.deepEqual(body,{
      event_type:type,start_time:start,invitee:{name:"Fixture",email:"fixture@example.invalid",timezone:"Europe/Paris"},
      location:{kind:"google_conference"},tracking:{utm_content:"op",utm_source:null,utm_campaign:null,utm_medium:null,utm_term:null,salesforce_uuid:null},
    });}
    return {resource:url===meeting?appointment:guest};
  });
  assert.equal(await p.reserve("op",{start,minutes:30},{name:"Fixture",email:"fixture@example.invalid",zone:"Europe/Paris"}),ref);
  assert.equal((await p.observe("op",ref,false,()=>true)).status,"confirmed");
});
test("lecture externe hors entreprise ou non corrélée refusée",async()=>{
  const p=adapter(url=>({resource:url===meeting?appointment:guest}));
  await assert.rejects(p.observe("other",ref,false,()=>true),/UNRELATED/);
  await assert.rejects(p.observe("op","https://example.invalid/secret",true,()=>true),/REFERENCE/);
  await assert.rejects(adapter(url=>({resource:url===meeting?{...appointment,event_type:"other"}:guest})).observe("op",ref,true,()=>true),/UNRELATED/);
});
test("replanification, annulation et reprise sur limite fournisseur",async()=>{
  const newer=meeting+"/invitees/two";
  const p=adapter(url=>({resource:url===ref?{...guest,new_invitee:newer}:url===newer?{...guest,uri:newer,status:"canceled",tracking:null}:appointment}));
  const result=await p.observe("op",ref,true,()=>true);
  assert.equal(result.reference,newer);assert.equal(result.status,"cancelled");
  await assert.rejects(adapter(()=>new Response(null,{status:429,headers:{"Retry-After":"300"}})).slots(start,end),{message:"CALENDAR_RATE_LIMIT",retryAfter:300});
});
test("réconciliation après réponse perdue sans rejouer la création",async()=>{
  const p=adapter((url,opts)=>{assert.equal(opts?.method,"GET");return {collection:url.includes("/invitees?")?[guest]:[appointment]}});
  assert.equal(await p.discover("op",start),ref);
  assert.equal(await p.discover("other",start),null);
});

test("refus de création : opération, statut amont et champs techniques filtrés",async t=>{
  const log=t.mock.method(console,"warn",()=>{});
  const payload={title:"Invalid Argument",message:"Specified location kind is not configured for this event type.",
    code:"sensitive-token",details:[{parameter:"location.kind",code:"invalid",message:guest.email},
      {parameter:guest.email,code:"private-password"}],email:guest.email};
  const p=adapter(url=>url===type?{resource:info}:Response.json(payload,{status:400}));
  await assert.rejects(p.reserve("op",{start,minutes:30},{name:"Private Name",email:guest.email,zone:"UTC"}),
    {message:"CALENDAR_REJECTED",status:503,rejected:true});
  assert.deepEqual(JSON.parse(JSON.stringify(log.mock.calls[0].arguments)),["calendly.failure",{
    operation:"create_invitee",httpStatus:400,title:"Invalid Argument",reason:"location_not_configured",
    details:[{code:"invalid",parameter:"location.kind"}],
  }]);
});

test("échec incertain : une seule création et aucun contenu brut dans le diagnostic",async t=>{
  const log=t.mock.method(console,"warn",()=>{});
  for(const response of [new Response("private-password",{status:502}),
    new Response("x".repeat(9000),{status:503}),new Response("private data",{status:201})]){
    let posts=0;
    const p=adapter(url=>{
      if(url===type)return {resource:info};
      posts++;
      return response;
    });
    await assert.rejects(p.reserve("op",{start,minutes:30},{name:"Fixture",email:guest.email,zone:"UTC"}),{rejected:false});
    assert.equal(posts,1);
    assert.deepEqual(log.mock.calls.at(-1)?.arguments,["calendly.failure",{
      operation:"create_invitee",httpStatus:response.status,...(response.ok?{reason:"invalid_json"}:{}),
    }]);
  }
});

test("un refus avant la création identifie la lecture du type Calendly",async t=>{
  const log=t.mock.method(console,"warn",()=>{});
  const p=adapter(()=>Response.json({title:"Insufficient scope",code:"insufficient_scope"},{status:403}));
  await assert.rejects(p.reserve("op",{start,minutes:30},{name:"Fixture",email:guest.email,zone:"UTC"}),{status:503});
  assert.deepEqual(JSON.parse(JSON.stringify(log.mock.calls[0].arguments)),["calendly.failure",{
    operation:"get_event_type",httpStatus:403,title:"Insufficient scope",code:"insufficient_scope",details:[],
  }]);
});
