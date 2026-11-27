import { randomUUID } from "node:crypto";
import { expect,test } from "@playwright/test";
const headers={origin:"http://127.0.0.1:3128"};
const endpoint=(id:string)=>"/api/quote-requests/"+id+"/ai-analysis";
test("AI authorization and disabled configuration through Next.js",async({request})=>{
  const data={operation:randomUUID()};
  expect((await request.post(endpoint(randomUUID()),{headers,data})).status()).toBe(401);
  await request.post("/auth/connexion",{headers,maxRedirects:0,form:{email:"alice@example.invalid",password:"test-only"}});
  const prospect=await request.post("/api/prospects",{headers,data:{name:"Fixture",sector:"Test",city:"Paris"}});
  const row=await request.post("/api/quote-requests",{headers,data:{title:"Test",description:"Demande fictive",prospect_id:(await prospect.json()).data.id}});
  const url=endpoint((await row.json()).data.id);
  expect((await request.post(url,{headers:{origin:"https://example.invalid"},data})).status()).toBe(403);
  expect((await request.post(url,{headers,data:{...data,model:"forged"}})).status()).toBe(400);
  const disabled=await request.post(url,{headers,data});expect(disabled.status()).toBe(503);
  expect(await disabled.json()).toEqual({error:"NOT_CONFIGURED"});expect(disabled.headers()["cache-control"]).toContain("no-store");
  await request.post("/auth/entreprise",{headers,maxRedirects:0,form:{company_id:"20000000-0000-4000-8000-000000000002"}});
  expect((await request.post(url,{headers,data})).status()).toBe(404);
});
