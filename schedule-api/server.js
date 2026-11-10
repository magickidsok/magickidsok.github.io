import http from "node:http";
import { timingSafeEqual, createHmac } from "node:crypto";

const PORT = Number(process.env.PORT || 10000);
const GH_OWNER = process.env.GITHUB_OWNER || "magickidsok";
const GH_REPO = process.env.GITHUB_REPO || "magickidsok.github.io";
const GH_BRANCH = process.env.GITHUB_BRANCH || "migration/programacion-github-json";
const GH_PATH = process.env.GITHUB_FILE_PATH || "data/programacion.json";
const GH_TOKEN = process.env.GITHUB_TOKEN;
const SUPABASE_API = process.env.SUPABASE_API || "https://bfedjvqhrxmkgaiaqtpm.supabase.co/functions/v1/mk-api";
const SCHEDULE_SIGNING_SECRET = process.env.SCHEDULE_SIGNING_SECRET || "";
const ALLOWED_ORIGINS = new Set([
  "https://headless-zchpdkyghyi-elmagickids-140b.wix-site-host.com",
  "https://headless-bmyiaymnvxx-elmagickids-140b.wix-site-host.com"
]);
let cached = null;
let cachedAt = 0;
let etag = null;
const clients = new Set();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization,if-none-match");
}
function ghUrl() {
  return `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}?ref=${encodeURIComponent(GH_BRANCH)}`;
}
async function readGithub(force=false) {
  if (!force && cached && Date.now()-cachedAt < 5000) return cached;
  if (!GH_TOKEN) throw new Error("GITHUB_TOKEN_NOT_CONFIGURED");
  const r = await fetch(ghUrl(), {headers:{authorization:`Bearer ${GH_TOKEN}`,"accept":"application/vnd.github+json","x-github-api-version":"2022-11-28"}});
  if (!r.ok) throw new Error(`GITHUB_READ_${r.status}`);
  const data = await r.json();
  const json = JSON.parse(Buffer.from(data.content.replace(/\n/g,""),"base64").toString("utf8"));
  cached = json; cachedAt=Date.now(); etag=data.sha;
  return json;
}
async function writeGithub(schedule) {
  if (!GH_TOKEN) throw new Error("GITHUB_TOKEN_NOT_CONFIGURED");
  const get = await fetch(ghUrl(), {headers:{authorization:`Bearer ${GH_TOKEN}`,"accept":"application/vnd.github+json","x-github-api-version":"2022-11-28"}});
  if (!get.ok) throw new Error(`GITHUB_READ_${get.status}`);
  const current = await get.json();
  const decoded = JSON.parse(Buffer.from(current.content.replace(/\n/g,""),"base64").toString("utf8"));
  const next = {...schedule, schemaVersion:1, section:"programacion", revision:Number(decoded.revision||0)+1, updatedAt:new Date().toISOString()};
  const content = Buffer.from(JSON.stringify(next,null,2)+"\n").toString("base64");
  const put = await fetch(ghUrl().split("?")[0], {method:"PUT",headers:{authorization:`Bearer ${GH_TOKEN}`,"accept":"application/vnd.github+json","content-type":"application/json","x-github-api-version":"2022-11-28"},body:JSON.stringify({message:`Update MAGIC KIDS schedule revision ${next.revision}`,content,sha:current.sha,branch:GH_BRANCH})});
  if (!put.ok) throw new Error(`GITHUB_WRITE_${put.status}: ${(await put.text()).slice(0,300)}`);
  cached=next; cachedAt=Date.now();
  for (const client of clients) client.write(`event: schedule\ndata: ${JSON.stringify(next)}\n\n`);
  return next;
}
function b64url(value) { return Buffer.from(value).toString("base64url"); }
function signScheduleSession(payload) {
  if (!SCHEDULE_SIGNING_SECRET) throw new Error("SCHEDULE_SIGNING_SECRET_NOT_CONFIGURED");
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SCHEDULE_SIGNING_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyScheduleSession(token) {
  if (!SCHEDULE_SIGNING_SECRET || typeof token !== "string") return false;
  const parts = token.split("."); if (parts.length !== 2) return false;
  const expected = createHmac("sha256", SCHEDULE_SIGNING_SECRET).update(parts[0]).digest();
  let supplied; try { supplied = Buffer.from(parts[1], "base64url"); } catch { return false; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try { const p=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8")); return p.scope==="schedule:write" && Number(p.exp)>Math.floor(Date.now()/1000); } catch { return false; }
}
function validSchedule(x) {
  if (!x || !Array.isArray(x.entries) || x.entries.length<1 || x.entries.length>200) return false;
  return x.entries.every((e,i)=>Number.isInteger(e.position)&&e.position===i+1&&/^([01]\d|2[0-3]):[0-5]\d$/.test(e.start_time)&&typeof e.title==="string"&&e.title.trim().length>0&&e.title.length<=180);
}
const server=http.createServer(async(req,res)=>{
  cors(req,res);
  if(req.method==="OPTIONS"){res.writeHead(204);return res.end();}
  const url=new URL(req.url,"http://localhost");
  if(req.method==="GET"&&url.pathname==="/health")return send(res,200,{ok:true,service:"magic-kids-schedule-api",branch:GH_BRANCH});
  if(req.method==="GET"&&url.pathname==="/schedule"){
    try {const value=await readGithub(); return send(res,200,value,{"cache-control":"public, max-age=2, stale-while-revalidate=5"});}
    catch(e){return send(res,503,{ok:false,error:e.message});}
  }
  if(req.method==="GET"&&url.pathname==="/events"){
    res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache, no-transform","connection":"keep-alive","access-control-allow-origin":req.headers.origin||"*"});
    res.write("event: connected\ndata: {}\n\n");clients.add(res);req.on("close",()=>clients.delete(res));return;
  }
  if(req.method==="POST"&&url.pathname==="/schedule/session"){
    const adminToken=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    if(!adminToken)return send(res,401,{ok:false,error:"UNAUTHORIZED"});
    if(!SCHEDULE_SIGNING_SECRET)return send(res,503,{ok:false,error:"SCHEDULE_SIGNING_SECRET_NOT_CONFIGURED"});
    try {
      const auth=await fetch(SUPABASE_API+"/admin/state",{headers:{authorization:"Bearer "+adminToken,accept:"application/json"},cache:"no-store"});
      const authData=await auth.json().catch(()=>({}));
      if(!auth.ok||!authData.ok)return send(res,401,{ok:false,error:"ADMIN_AUTH_FAILED"});
      const now=Math.floor(Date.now()/1000),exp=now+8*60*60;
      const sessionToken=signScheduleSession({scope:"schedule:write",iat:now,exp});
      return send(res,200,{ok:true,sessionToken,expiresAt:new Date(exp*1000).toISOString()});
    } catch(e) { return send(res,503,{ok:false,error:"SCHEDULE_SESSION_UNAVAILABLE"}); }
  }
  if(req.method==="POST"&&url.pathname==="/schedule"){
    const scheduleSession=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    if(!scheduleSession)return send(res,401,{ok:false,error:"UNAUTHORIZED"});
    if(!verifyScheduleSession(scheduleSession))return send(res,401,{ok:false,error:"SCHEDULE_SESSION_INVALID_OR_EXPIRED"});
    let raw="";for await(const chunk of req)raw+=chunk;
    if(raw.length>100000)return send(res,413,{ok:false,error:"PAYLOAD_TOO_LARGE"});
    let body;try{body=JSON.parse(raw);}catch{return send(res,400,{ok:false,error:"INVALID_JSON"});}
    if(!validSchedule(body))return send(res,400,{ok:false,error:"INVALID_SCHEDULE"});
    try{const value=await writeGithub(body);return send(res,200,{ok:true,revision:value.revision,updatedAt:value.updatedAt});}
    catch(e){return send(res,502,{ok:false,error:e.message});}
  }
  return send(res,404,{ok:false,error:"NOT_FOUND"});
});
server.listen(PORT,"0.0.0.0",()=>console.log(`schedule API listening on ${PORT}`));
