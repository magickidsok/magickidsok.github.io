const OWNER = "magickidsok";
const REPO = "magickidsok.github.io";
const BRANCH = "migration/programacion-github-json";
const PATH = "data/programacion.json";
const SUPABASE_API = "https://bfedjvqhrxmkgaiaqtpm.supabase.co/functions/v1/mk-api";
const ALLOWED = new Set([
  "https://headless-zchpdkyghyi-elmagickids-140b.wix-site-host.com",
  "https://headless-bmyiaymnvxx-elmagickids-140b.wix-site-host.com"
]);

function json(data, status=200, origin=null, extra={}) {
  const headers = {"content-type":"application/json; charset=utf-8","cache-control":"no-store",...extra};
  if (origin && ALLOWED.has(origin)) { headers["access-control-allow-origin"]=origin; headers.vary="Origin"; }
  return new Response(JSON.stringify(data),{status,headers});
}
function b64url(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function unb64url(s) { const normalized=s.replace(/-/g,"+").replace(/_/g,"/"); const padded=normalized+"=".repeat((4-normalized.length%4)%4); return Uint8Array.from(atob(padded),c=>c.charCodeAt(0)); }
async function hmacKey(secret) { return crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]); }
async function sign(payload,secret) {
  const body=b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig=await crypto.subtle.sign("HMAC",await hmacKey(secret),new TextEncoder().encode(body));
  return body+"."+b64url(sig);
}
async function verify(token,secret) {
  try {
    const [body,sig,...rest]=String(token||"").split(".");
    if(!body||!sig||rest.length) return false;
    const ok=await crypto.subtle.verify("HMAC",await hmacKey(secret),unb64url(sig),new TextEncoder().encode(body));
    if(!ok)return false;
    const p=JSON.parse(new TextDecoder().decode(unb64url(body)));
    return p.scope==="schedule:write" && Number(p.exp)>Math.floor(Date.now()/1000);
  } catch { return false; }
}
function githubHeaders(env) {
  return {authorization:"Bearer "+env.GITHUB_TOKEN,accept:"application/vnd.github+json","x-github-api-version":"2022-11-28"};
}
async function getSchedule(env) {
  const u="https://api.github.com/repos/"+OWNER+"/"+REPO+"/contents/"+PATH+"?ref="+encodeURIComponent(BRANCH);
  const r=await fetch(u,{headers:githubHeaders(env)});
  if(!r.ok)throw new Error("GITHUB_READ_"+r.status);
  const file=await r.json();
  const raw=atob(file.content.replace(/\n/g,""));
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  return {data:JSON.parse(new TextDecoder().decode(bytes)),sha:file.sha};
}
function validSchedule(x) {
  return !!x && Array.isArray(x.entries) && x.entries.length>=1 && x.entries.length<=200 &&
    x.entries.every((e,i)=>Number.isInteger(e.position)&&e.position===i+1&&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(e.start_time)&&typeof e.title==="string"&&e.title.trim().length>0&&e.title.length<=180);
}
async function saveSchedule(env,schedule) {
  const current=await getSchedule(env);
  const next={...schedule,schemaVersion:1,section:"programacion",revision:Number(current.data.revision||0)+1,updatedAt:new Date().toISOString()};
  const content=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(next,null,2)+"\n")));
  const url="https://api.github.com/repos/"+OWNER+"/"+REPO+"/contents/"+PATH;
  const r=await fetch(url,{method:"PUT",headers:{...githubHeaders(env),"content-type":"application/json"},body:JSON.stringify({
    message:"Update MAGIC KIDS schedule revision "+next.revision,
    content,sha:current.sha,branch:BRANCH
  })});
  if(!r.ok)throw new Error("GITHUB_WRITE_"+r.status);
  return next;
}
export default {
  async fetch(request,env) {
    const origin=request.headers.get("Origin");
    const url=new URL(request.url);
    if(request.method==="OPTIONS") {
      const h={"access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,authorization","access-control-max-age":"86400"};
      if(origin&&ALLOWED.has(origin)){h["access-control-allow-origin"]=origin;h.vary="Origin";}
      return new Response(null,{status:204,headers:h});
    }
    if(url.pathname==="/health"&&request.method==="GET")return json({ok:true,service:"magic-kids-programacion-worker",storage:"github-json"},200,origin);
    if(url.pathname==="/schedule"&&request.method==="GET") {
      try { const {data}=await getSchedule(env); return json(data,200,origin,{"cache-control":"public, max-age=15, stale-while-revalidate=30"}); }
      catch(e){return json({ok:false,error:e.message},503,origin);}
    }
    if(url.pathname==="/schedule/session"&&request.method==="POST") {
      const adminToken=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
      if(!adminToken)return json({ok:false,error:"UNAUTHORIZED"},401,origin);
      if(!env.SCHEDULE_SIGNING_SECRET)return json({ok:false,error:"SCHEDULE_SIGNING_SECRET_NOT_CONFIGURED"},503,origin);
      try {
        const auth=await fetch(SUPABASE_API+"/admin/state",{headers:{authorization:"Bearer "+adminToken,accept:"application/json"},cache:"no-store"});
        const authData=await auth.json().catch(()=>({}));
        if(!auth.ok||!authData.ok)return json({ok:false,error:"ADMIN_AUTH_FAILED"},401,origin);
        const now=Math.floor(Date.now()/1000),exp=now+8*60*60;
        const sessionToken=await sign({scope:"schedule:write",iat:now,exp},env.SCHEDULE_SIGNING_SECRET);
        return json({ok:true,sessionToken,expiresAt:new Date(exp*1000).toISOString()},200,origin);
      } catch { return json({ok:false,error:"SCHEDULE_SESSION_UNAVAILABLE"},503,origin); }
    }
    if(url.pathname==="/schedule"&&request.method==="POST") {
      const token=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
      if(!await verify(token,env.SCHEDULE_SIGNING_SECRET||""))return json({ok:false,error:"SCHEDULE_SESSION_INVALID_OR_EXPIRED"},401,origin);
      let body;try{body=await request.json();}catch{return json({ok:false,error:"INVALID_JSON"},400,origin);}
      if(!validSchedule(body))return json({ok:false,error:"INVALID_SCHEDULE"},400,origin);
      try {const next=await saveSchedule(env,body);return json({ok:true,revision:next.revision,updatedAt:next.updatedAt},200,origin);}
      catch(e){return json({ok:false,error:e.message},502,origin);}
    }
    return json({ok:false,error:"NOT_FOUND"},404,origin);
  }
};