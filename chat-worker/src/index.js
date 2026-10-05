const ALLOWED_ORIGINS = new Set(["https://magickidsok.online","https://www.magickidsok.online","http://magickidsok.online","http://www.magickidsok.online","https://magickidsok.github.io","https://magickidsok-github-io.elmagickids.workers.dev"]);
const COOKIE = "MKCHAT_SESSION";
const ADMIN_COOKIE = "MKADMIN_SESSION";
const ADMIN_SESSION_SECONDS = 60 * 60 * 12;
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const PASSWORD_ITERATIONS = 120000;

function allowedOrigin(origin){
  const value=String(origin||"").trim();
  if(ALLOWED_ORIGINS.has(value))return value;
  try{
    const host=new URL(value).hostname.toLowerCase();
    if(host==="magickidsok.online"||host==="www.magickidsok.online")return value;
    if(host.endsWith(".github.io")&&host==="magickidsok.github.io")return value;
  }catch(e){}
  return "";
}
function json(data,status,origin,extraHeaders){
  const h=new Headers(Object.assign({
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store"
  },extraHeaders||{}));
  const allow=allowedOrigin(origin);
  if(allow){
    h.set("Access-Control-Allow-Origin",allow);
    h.set("Access-Control-Allow-Credentials","true");
    h.set("Vary","Origin");
  }
  return new Response(JSON.stringify(data),{status:status||200,headers:h});
}
function cors(request){
  const allow=allowedOrigin(request.headers.get("Origin")||"");
  const h={
    "Access-Control-Allow-Methods":"GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, Authorization",
    "Access-Control-Allow-Credentials":"true",
    "Access-Control-Max-Age":"86400",
    "Vary":"Origin"
  };
  if(allow)h["Access-Control-Allow-Origin"]=allow;
  return new Response(null,{status:204,headers:h});
}
function bytesToB64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
function b64ToBytes(str){str=str.replace(/-/g,"+").replace(/_/g,"/");while(str.length%4)str+="=";const bin=atob(str),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
function encJson(v){return bytesToB64(new TextEncoder().encode(JSON.stringify(v)));}
function decJson(s){return JSON.parse(new TextDecoder().decode(b64ToBytes(s)));}
function safeEq(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a[i]^b[i];return x===0;}
async function hmac(secret,payload){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload)));}
async function makeSession(uid,secret){const body=encJson({uid:uid,exp:Math.floor(Date.now()/1000)+SESSION_SECONDS});return body+"."+bytesToB64(await hmac(secret,body));}
async function readSession(request,env){
  const token=readAuthToken(request,COOKIE);
  if(!token||!env.SESSION_SECRET)return null;
  const parts=token.split(".");if(parts.length!==2)return null;
  try{const body=parts[0],sig=b64ToBytes(parts[1]),expected=await hmac(env.SESSION_SECRET,body);if(!safeEq(sig,expected))return null;const data=decJson(body);if(!data.uid||!data.exp||data.exp<Math.floor(Date.now()/1000))return null;return data;}catch(e){return null;}
}
function setSessionCookie(token){return COOKIE+"="+token+"; Path=/; HttpOnly; Secure; SameSite=None; Max-Age="+SESSION_SECONDS;}
function readAuthToken(request,name){
  const auth=String(request.headers.get("Authorization")||"");
  if(/^Bearer\s+/i.test(auth))return auth.replace(/^Bearer\s+/i,"").trim();
  const m=(request.headers.get("Cookie")||"").match(new RegExp("(?:^|;\\s*)"+name+"=([^;]+)"));
  return m?m[1]:"";
}
function makeAdminSession(secret){return makeAdminSessionToken(secret);}
async function makeAdminSessionToken(secret){const body=encJson({admin:1,exp:Math.floor(Date.now()/1000)+ADMIN_SESSION_SECONDS});return body+"."+bytesToB64(await hmac(secret,body));}
async function readAdminSession(request,env){
  const token=readAuthToken(request,ADMIN_COOKIE);
  if(!token||!env.SESSION_SECRET)return false;
  const parts=token.split(".");if(parts.length!==2)return false;
  try{const body=parts[0],sig=b64ToBytes(parts[1]),expected=await hmac(env.SESSION_SECRET,body);if(!safeEq(sig,expected))return false;const data=decJson(body);return !!(data.admin&&data.exp&&data.exp>=Math.floor(Date.now()/1000));}catch(e){return false;}
}
function setAdminSessionCookie(token){return ADMIN_COOKIE+"="+token+"; Path=/; HttpOnly; Secure; SameSite=None; Max-Age="+ADMIN_SESSION_SECONDS;}
function clearAdminSessionCookie(){return ADMIN_COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0";}
function clearSessionCookie(){return COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0";}
function normalizeNick(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9]/g,"").toUpperCase();}
function validNick(v){return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _.-]{3,24}$/.test(v);}
function cleanText(v){return String(v||"").replace(/https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|net|org|es|ar|tv|site)\b/gi,"").replace(/\s+/g," ").trim().slice(0,180);}
async function body(request){try{return await request.json();}catch(e){return {};}}
async function hashPassword(password,saltBytes,iterations){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),{name:"PBKDF2"},false,["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt:saltBytes,iterations:iterations||PASSWORD_ITERATIONS,hash:"SHA-256"},key,256));
}
async function makePasswordRecord(password){
  // New accounts use a lighter KDF so registration is fast on Cloudflare Workers.
  // Existing accounts keep the original 120k-iteration format.
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const hash=await hashPassword(password,salt,30000);
  return {salt:"v2:"+bytesToB64(salt),hash:bytesToB64(hash)};
}
async function verifyPassword(password,saltB64,hashB64){
  const s=String(saltB64||"");
  const isV2=s.startsWith("v2:");
  const raw=isV2?s.slice(3):s;
  return safeEq(await hashPassword(password,b64ToBytes(raw),isV2?30000:PASSWORD_ITERATIONS),b64ToBytes(hashB64));
}



function requireR2(env){if(!env.VIDEOS)throw new Error("R2 no configurado: falta el binding VIDEOS.");return env.VIDEOS;}
async function ensureVideoSchema(db){
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS video_categories (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT,object_key TEXT NOT NULL UNIQUE,title TEXT NOT NULL,category_id INTEGER,thumbnail_key TEXT,video_type TEXT NOT NULL DEFAULT 'program',duration_seconds REAL NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS video_schedule (id INTEGER PRIMARY KEY AUTOINCREMENT,video_id INTEGER NOT NULL,start_time TEXT NOT NULL,position INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_video_schedule_position ON video_schedule(position)"),db.prepare("CREATE INDEX IF NOT EXISTS idx_video_schedule_enabled_position ON video_schedule(enabled,position)"),db.prepare("CREATE INDEX IF NOT EXISTS idx_video_schedule_video_id ON video_schedule(video_id)"),db.prepare("CREATE TABLE IF NOT EXISTS viewer_presence (viewer_id TEXT PRIMARY KEY,last_seen INTEGER NOT NULL)"),db.prepare("CREATE TABLE IF NOT EXISTS live_overlay (id INTEGER PRIMARY KEY CHECK(id=1),message TEXT NOT NULL DEFAULT '',expires_at INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL DEFAULT 0,visible INTEGER NOT NULL DEFAULT 0)")
  ]);
  const cols=await db.prepare("PRAGMA table_info(videos)").all();
  if(!(cols.results||[]).some(x=>x.name==="video_type")){
    await db.prepare("ALTER TABLE videos ADD COLUMN video_type TEXT NOT NULL DEFAULT 'program'").run();
  }
  if(!(cols.results||[]).some(x=>x.name==="category_position")){
    await db.prepare("ALTER TABLE videos ADD COLUMN category_position INTEGER NOT NULL DEFAULT 0").run();
  }
  if(!(cols.results||[]).some(x=>x.name==="duration_seconds")){
    await db.prepare("ALTER TABLE videos ADD COLUMN duration_seconds REAL NOT NULL DEFAULT 0").run();
  }
  await db.prepare("CREATE TABLE IF NOT EXISTS channel_control (id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL DEFAULT 'stopped',generation INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,started_at INTEGER NOT NULL DEFAULT 0)").run();
  const cc=await db.prepare("PRAGMA table_info(channel_control)").all();
  if(!(cc.results||[]).some(x=>x.name==="started_at")) await db.prepare("ALTER TABLE channel_control ADD COLUMN started_at INTEGER NOT NULL DEFAULT 0").run();
  const state=await db.prepare("SELECT id FROM channel_control WHERE id=1").first();
  if(!state)await db.prepare("INSERT INTO channel_control(id,status,generation,updated_at,started_at) VALUES(1,'stopped',0,?,0)").bind(Date.now()).run();
}
async function adminVideos(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const rows=await env.DB.prepare("SELECT v.id,v.object_key,v.title,v.category_id,c.name AS category,v.thumbnail_key,v.video_type,v.duration_seconds,v.created_at,v.updated_at FROM videos v LEFT JOIN video_categories c ON c.id=v.category_id ORDER BY v.id DESC").all();
  return json({videos:rows.results||[],r2Configured:!!env.VIDEOS},200,origin);
}
async function adminRepairR2Keys(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const bucket=requireR2(env);
  const listed=await bucket.list({prefix:"videos/",limit:1000});
  const objects=listed.objects||[];
  const rows=await env.DB.prepare("SELECT id,object_key,title FROM videos ORDER BY id").all();
  const dbRows=rows.results||[];
  const used=new Set(), repaired=[], missing=[];
  const uuidRe=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const update=(row,match)=>{
    used.add(match.key);
    if(match.key!==row.object_key){
      repaired.push({id:row.id,title:row.title,from:row.object_key,to:match.key});
      return env.DB.prepare("UPDATE videos SET object_key=?,updated_at=? WHERE id=?").bind(match.key,Date.now(),row.id).run();
    }
    return null;
  };
  const pending=[];
  for(const row of dbRows){
    const m=String(row.object_key||"").match(uuidRe);
    if(!m){pending.push(row);continue;}
    const uuid=m[0].toLowerCase();
    let match=objects.find(o=>!used.has(o.key)&&String(o.key||"").toLowerCase().includes(uuid));
    if(!match){
      const titleNorm=String(row.title||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
      match=objects.find(o=>{
        if(used.has(o.key))return false;
        const base=String(o.key||"").split("/").pop().replace(/\.[^.]+$/,"");
        return titleNorm && String(base).toLowerCase().replace(/[^a-z0-9]+/g,"")===titleNorm;
      });
    }
    if(match)await update(row,match);else pending.push(row);
  }
  const remainingObjects=objects.filter(o=>!used.has(o.key));
  if(pending.length===1&&remainingObjects.length===1){
    await update(pending[0],remainingObjects[0]);
  }else{
    for(const row of pending)missing.push({id:row.id,title:row.title,reason:"No se pudo identificar de forma segura el objeto R2"});
  }
  return json({ok:true,repaired,missing,checked:dbRows.length,r2Objects:objects.length},200,origin);
}
async function adminCategories(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  if(request.method==="GET"){
    const rows=await env.DB.prepare("SELECT id,name FROM video_categories ORDER BY name COLLATE NOCASE").all();
    return json({categories:rows.results||[]},200,origin);
  }
  const b=await body(request),name=String(b.name||"").trim().slice(0,60);
  if(!name)return json({error:"Nombre de categoría requerido."},400,origin);
  try{await env.DB.prepare("INSERT INTO video_categories(name,created_at) VALUES(?,?)").bind(name,Date.now()).run();return adminCategories(new Request(request.url,{method:"GET",headers:request.headers}),env,origin);}
  catch(e){return json({error:"La categoría ya existe o no se pudo crear."},409,origin);}
}
async function adminUpload(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const bucket=requireR2(env);
  const form=await request.formData();
  const files=form.getAll("files").filter(f=>f&&typeof f.arrayBuffer==="function");
  if(!files.length){
    const one=form.get("file");
    if(one&&typeof one.arrayBuffer==="function")files.push(one);
  }
  if(!files.length)return json({error:"Seleccioná uno o más videos."},400,origin);
  const categoryId=Number(form.get("categoryId")||0)||null;
  const videoType=String(form.get("videoType")||"program")==="commercial"?"commercial":"program";
  const requestedTitle=String(form.get("title")||"").trim().slice(0,180);
  const uploaded=[];
  for(const file of files){
    const rawName=String(file.name||"video.mp4").split("/").pop();
    const base=rawName.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
    const title=(files.length===1&&requestedTitle?requestedTitle:base||"Video").slice(0,180);
    const name=rawName.replace(/[^A-Za-z0-9._-]/g,"_");
    const key="videos/"+Date.now()+"-"+crypto.randomUUID()+"-"+name;
    const data=await file.arrayBuffer();
    await bucket.put(key,data,{httpMetadata:{contentType:file.type||"video/mp4",cacheControl:"public, max-age=31536000"}});
    const now=Date.now();
    const nextPosRow=categoryId?await env.DB.prepare("SELECT COALESCE(MAX(category_position),-1)+1 AS next_pos FROM videos WHERE category_id=?").bind(categoryId).first():{next_pos:0};
    const categoryPosition=Number(nextPosRow?.next_pos||0);
    const durationSeconds=Math.max(0,Math.min(86400,Number(form.get("durationSeconds")||0)||0));
    const result=await env.DB.prepare("INSERT INTO videos(object_key,title,category_id,category_position,video_type,duration_seconds,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(key,title,categoryId,categoryPosition,videoType,durationSeconds,now,now).run();
    uploaded.push({id:result.meta?.last_row_id||null,key,title,videoType});
  }
  return json({ok:true,count:uploaded.length,uploaded},201,origin);
}
async function adminUploadInitiate(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const bucket=requireR2(env);
  const b=await body(request);
  const rawName=String(b.name||"video.mp4").split("/").pop().slice(0,220);
  const name=rawName.replace(/[^A-Za-z0-9._-]/g,"_")||"video.mp4";
  const key="videos/"+Date.now()+"-"+crypto.randomUUID()+"-"+name;
  const contentType=String(b.contentType||"video/mp4").slice(0,120)||"video/mp4";
  const upload=await bucket.createMultipartUpload(key,{httpMetadata:{contentType,cacheControl:"public, max-age=31536000"}});
  return json({ok:true,key:upload.key,uploadId:upload.uploadId},200,origin);
}
async function adminUploadPart(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const u=new URL(request.url),key=String(u.searchParams.get("key")||""),uploadId=String(u.searchParams.get("uploadId")||""),partNumber=Number(u.searchParams.get("partNumber")||0);
  if(!key.startsWith("videos/")||!uploadId||!Number.isInteger(partNumber)||partNumber<1||partNumber>10000||!request.body)return json({error:"Parte de subida inválida."},400,origin);
  try{
    const upload=requireR2(env).resumeMultipartUpload(key,uploadId);
    const part=await upload.uploadPart(partNumber,request.body);
    return json({ok:true,part:{partNumber:part.partNumber,etag:part.etag}},200,origin);
  }catch(e){return json({error:"No se pudo subir esta parte: "+String(e&&e.message||e)},400,origin);}
}
async function adminUploadComplete(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const bucket=requireR2(env),b=await body(request);
  const key=String(b.key||""),uploadId=String(b.uploadId||"");
  if(!key.startsWith("videos/")||!uploadId||!Array.isArray(b.parts)||!b.parts.length)return json({error:"Datos de finalización inválidos."},400,origin);
  try{
    const upload=bucket.resumeMultipartUpload(key,uploadId);
    const parts=b.parts.map(p=>({partNumber:Number(p.partNumber),etag:String(p.etag)})).filter(p=>Number.isInteger(p.partNumber)&&p.partNumber>0&&p.etag);
    if(!parts.length)return json({error:"No hay partes válidas."},400,origin);
    const object=await upload.complete(parts);
    const videoType=String(b.videoType||"program")==="commercial"?"commercial":"program";
    const categoryId=Number(b.categoryId||0)||null;
    const title=String(b.title||"Video").trim().slice(0,180)||"Video";
    const durationSeconds=Math.max(0,Math.min(86400,Number(b.durationSeconds||0)||0));
    const now=Date.now();
    const nextPosRow=categoryId?await env.DB.prepare("SELECT COALESCE(MAX(category_position),-1)+1 AS next_pos FROM videos WHERE category_id=?").bind(categoryId).first():{next_pos:0};
    const categoryPosition=Number(nextPosRow?.next_pos||0);
    const result=await env.DB.prepare("INSERT INTO videos(object_key,title,category_id,category_position,video_type,duration_seconds,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(key,title,categoryId,categoryPosition,videoType,durationSeconds,now,now).run();
    return json({ok:true,id:result.meta?.last_row_id||null,key,title,videoType,durationSeconds,etag:object.httpEtag},201,origin);
  }catch(e){return json({error:"No se pudo completar la subida: "+String(e&&e.message||e)},400,origin);}
}
async function adminUploadAbort(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const u=new URL(request.url),key=String(u.searchParams.get("key")||""),uploadId=String(u.searchParams.get("uploadId")||"");
  if(!key.startsWith("videos/")||!uploadId)return json({error:"Datos de cancelación inválidos."},400,origin);
  try{await requireR2(env).resumeMultipartUpload(key,uploadId).abort();return json({ok:true},200,origin);}
  catch(e){return json({error:"No se pudo cancelar la subida."},400,origin);}
}
async function adminVideoDurations(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const b=await body(request);
  const items=Array.isArray(b.items)?b.items:[];
  const clean=[];
  for(const x of items){
    const id=Number(x.id||0),duration=Math.max(0,Math.min(86400,Number(x.durationSeconds||0)||0));
    if(Number.isInteger(id)&&id>0&&duration>0)clean.push({id,duration});
  }
  if(!clean.length)return json({ok:true,updated:0},200,origin);
  const now=Date.now(),unique=[...new Map(clean.map(x=>[x.id,x])).values()],statements=[];
  for(const x of unique)statements.push(env.DB.prepare("UPDATE videos SET duration_seconds=?,updated_at=? WHERE id=?").bind(x.duration,now,x.id));
  for(let i=0;i<statements.length;i+=250)await env.DB.batch(statements.slice(i,i+250));
  return json({ok:true,updated:unique.length},200,origin);
}

async function adminVideoCategory(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const b=await body(request);
  const id=Number(b.id||0);
  const categoryId=b.categoryId===null||b.categoryId===""?null:Number(b.categoryId||0)||null;
  if(!id)return json({error:"Video inválido."},400,origin);
  const video=await env.DB.prepare("SELECT id FROM videos WHERE id=?").bind(id).first();
  if(!video)return json({error:"Video no encontrado."},404,origin);
  if(categoryId!==null){
    const cat=await env.DB.prepare("SELECT id FROM video_categories WHERE id=?").bind(categoryId).first();
    if(!cat)return json({error:"Carpeta no encontrada."},404,origin);
  }
  const nextPosRow=categoryId?await env.DB.prepare("SELECT COALESCE(MAX(category_position),-1)+1 AS next_pos FROM videos WHERE category_id=?").bind(categoryId).first():{next_pos:0};
  const categoryPosition=Number(nextPosRow?.next_pos||0);
  await env.DB.prepare("UPDATE videos SET category_id=?,category_position=?,updated_at=? WHERE id=?").bind(categoryId,categoryPosition,Date.now(),id).run();
  return adminVideos(request,env,origin);
}

async function adminVideoCategoryOrder(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const b=await body(request);
  const categoryId=Number(b.categoryId||0);
  const videoIds=Array.isArray(b.videoIds)?b.videoIds.map(Number).filter(Number.isInteger):[];
  if(!categoryId||!videoIds.length)return json({error:"Orden de carpeta inválido."},400,origin);
  const cat=await env.DB.prepare("SELECT id FROM video_categories WHERE id=?").bind(categoryId).first();
  if(!cat)return json({error:"Carpeta no encontrada."},404,origin);
  const unique=[...new Set(videoIds)];
  let pos=0;
  for(const id of unique){
    await env.DB.prepare("UPDATE videos SET category_position=?,updated_at=? WHERE id=? AND category_id=?").bind(pos++,Date.now(),id,categoryId).run();
  }
  return adminVideos(request,env,origin);
}

async function adminDeleteVideo(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const id=Number((await body(request)).id);if(!id)return json({error:"Video inválido."},400,origin);
  const row=await env.DB.prepare("SELECT object_key FROM videos WHERE id=?").bind(id).first();
  if(!row)return json({error:"Video no encontrado."},404,origin);
  if(env.VIDEOS)await env.VIDEOS.delete(row.object_key);
  await env.DB.prepare("DELETE FROM video_schedule WHERE video_id=?").bind(id).run();
  await env.DB.prepare("DELETE FROM videos WHERE id=?").bind(id).run();
  return json({ok:true},200,origin);
}
async function getLiveOverlay(request,env,origin){
  await ensureVideoSchema(env.DB);
  const row=await env.DB.prepare("SELECT message,expires_at,updated_at,visible FROM live_overlay WHERE id=1").first();
  const now=Date.now();
  const active=!!(row?.visible && row?.message && (Number(row.expires_at||0)===0 || Number(row.expires_at)>now));
  return json({visible:active,message:active?String(row.message):"",expiresAt:active?Number(row.expires_at||0):0,updatedAt:Number(row?.updated_at||0)},200,origin);
}
async function adminLiveOverlay(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  await ensureVideoSchema(env.DB);
  const b=await body(request);
  const action=String(b.action||"publish").toLowerCase();
  const now=Date.now();
  if(action==="clear"){
    await env.DB.prepare("INSERT INTO live_overlay(id,message,expires_at,updated_at,visible) VALUES(1,'',0,?,0) ON CONFLICT(id) DO UPDATE SET message='',expires_at=0,updated_at=?,visible=0").bind(now,now).run();
    return getLiveOverlay(request,env,origin);
  }
  const message=cleanText(b.message).slice(0,140);
  if(!message)return json({error:"Escribí un mensaje."},400,origin);
  const duration=String(b.duration||"60");
  const expiresAt=duration==="forever"?0:now+Math.max(40000,Math.min(3600000,Number(duration)*1000||60000));
  await env.DB.prepare("INSERT INTO live_overlay(id,message,expires_at,updated_at,visible) VALUES(1,?,?,?,1) ON CONFLICT(id) DO UPDATE SET message=?,expires_at=?,updated_at=?,visible=1").bind(message,expiresAt,now,message,expiresAt,now).run();
  return getLiveOverlay(request,env,origin);
}
async function ownPlaylist(request,env){
  await ensureVideoSchema(env.DB);
  const rows=await env.DB.prepare("SELECT s.position,s.start_time,v.title,v.object_key,v.video_type,v.duration_seconds FROM video_schedule s JOIN videos v ON v.id=s.video_id WHERE s.enabled=1 ORDER BY s.position ASC,s.start_time ASC").all();
  const scheduleRows=rows.results||[];
  const state=await env.DB.prepare("SELECT status,started_at FROM channel_control WHERE id=1").first();
  const origin=new URL(request.url).origin;
  const durations=scheduleRows.map(x=>Number(x.duration_seconds||0));
  let startIndex=0;
  if(String(state?.status)==="live"&&Number(state?.started_at)>0&&durations.length&&durations.every(d=>d>0)){
    let elapsed=Math.max(0,(Date.now()-Number(state.started_at))/1000);
    const total=durations.reduce((a,b)=>a+b,0);
    if(total>0){
      elapsed%=total;
      for(let i=0;i<durations.length;i++){if(elapsed<durations[i]){startIndex=i;break;}elapsed-=durations[i];}
    }
  }
  const ordered=scheduleRows.length?scheduleRows.slice(startIndex).concat(scheduleRows.slice(0,startIndex)):[];
  const lines=["#EXTM3U","#EXT-X-VERSION:3","#EXT-X-PLAYLIST-TYPE:VOD"];
  for(const x of ordered){
    const dur=Number(x.duration_seconds||0);
    lines.push("#EXTINF:"+(dur>0?dur.toFixed(3):"-1")+","+String(x.title||"Magic Kids").replace(/[\r\n]/g," "));
    lines.push(origin+"/media/"+String(x.object_key||"").split("/").map(encodeURIComponent).join("/"));
  }
  const h=new Headers({"Content-Type":"application/vnd.apple.mpegurl; charset=utf-8","Cache-Control":"no-store, no-cache","Access-Control-Allow-Origin":"*"});
  return new Response(lines.join("\n")+"\n",{status:200,headers:h});
}
async function appCurrentVideo(request,env){
  await ensureVideoSchema(env.DB);
  const row=await env.DB.prepare("SELECT v.title,v.object_key,v.video_type FROM video_schedule s JOIN videos v ON v.id=s.video_id WHERE s.enabled=1 ORDER BY s.position ASC,s.start_time ASC LIMIT 1").first();
  const resolved=(await resolveScheduledR2Keys(env,row?[row]:[]))[0];
  if(!resolved?.object_key)return new Response("No hay video programado.",{status:404,headers:{"Access-Control-Allow-Origin":"*","Cache-Control":"no-store"}});
  const origin=new URL(request.url).origin;
  const target=origin+"/media/"+String(resolved.object_key).split("/").map(encodeURIComponent).join("/");
  return Response.redirect(target,302);
}
async function adminM3u8(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const base=new URL(request.url).origin;
  return json({ok:true,url:base+"/magic-kids.m3u8",title:"Magic Kids — lista propia",note:"Generada automáticamente desde los videos y el orden guardados en tu panel. No depende de VDO Panel."},200,origin);
}
async function channelState(request,env,origin){
  await ensureVideoSchema(env.DB);
  const state=await env.DB.prepare("SELECT status,generation,updated_at,started_at FROM channel_control WHERE id=1").first();
  return json({status:state?.status||"stopped",generation:Number(state?.generation||0),updatedAt:Number(state?.updated_at||0),startedAt:Number(state?.started_at||0)},200,origin);
}
async function adminChannelControl(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const b=await body(request),action=String(b.action||"").toLowerCase();
  const state=await env.DB.prepare("SELECT generation FROM channel_control WHERE id=1").first();
  let status="";
  if(action==="start")status="live";
  else if(action==="stop")status="stopped";
  else if(action==="offair")status="offair";
  else if(action==="restart")status="live";
  else return json({error:"Acción inválida."},400,origin);
  const generation=Number(state?.generation||0)+(action==="restart"?1:0);
  const now=Date.now();
  const startedAt=(action==="start"||action==="restart")?now:Number((await env.DB.prepare("SELECT started_at FROM channel_control WHERE id=1").first())?.started_at||0);
  await env.DB.prepare("UPDATE channel_control SET status=?,generation=?,updated_at=?,started_at=? WHERE id=1").bind(status,generation,now,startedAt).run();
  return channelState(request,env,origin);
}
async function resolveScheduledR2Keys(env,rows){
  const listRows=Array.isArray(rows)?rows:[];
  if(!listRows.length)return listRows;
  const bucket=requireR2(env);
  const missing=[];
  await Promise.all(listRows.map(async row=>{
    const key=String(row.object_key||"");
    if(!key)return;
    try{
      const hit=await bucket.head(key);
      if(!hit)missing.push(row);
    }catch(e){missing.push(row);}
  }));
  if(!missing.length)return listRows;
  const listed=await bucket.list({prefix:"videos/",limit:1000});
  const objects=listed.objects||[];
  const uuidRe=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const norm=(s)=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
  return listRows.map(row=>{
    if(!missing.includes(row))return row;
    const key=String(row.object_key||"");
    const m=key.match(uuidRe);
    const uuid=m?m[0].toLowerCase():"";
    let match=uuid?objects.find(o=>String(o.key||"").toLowerCase().includes(uuid)):null;
    if(!match){
      const titleNorm=norm(row.title);
      match=objects.find(o=>{
        const base=String(o.key||"").split("/").pop().replace(/\.[^.]+$/,"");
        return titleNorm && norm(base)===titleNorm;
      });
    }
    return match?{...row,object_key:match.key}:row;
  });
}
async function publicSchedule(request,env,origin){
  await ensureVideoSchema(env.DB);
  const rows=await env.DB.prepare("SELECT s.id,s.video_id,s.start_time,s.position,s.enabled,v.title,v.object_key,v.thumbnail_key,v.video_type,v.duration_seconds,c.name AS category FROM video_schedule s JOIN videos v ON v.id=s.video_id LEFT JOIN video_categories c ON c.id=v.category_id WHERE s.enabled=1 ORDER BY s.position ASC,s.start_time ASC").all();
  // Las claves R2 guardadas en D1 son la fuente estable de reproducción.
  // La reparación de claves se ejecuta explícitamente desde el panel; no hacemos
  // cientos de HEAD de R2 en cada consulta pública de programación.
  const scheduleRows=rows.results||[];
  const state=await env.DB.prepare("SELECT status,generation,updated_at,started_at FROM channel_control WHERE id=1").first();
  return json({schedule:scheduleRows,channel:{status:state?.status||"stopped",generation:Number(state?.generation||0),updatedAt:Number(state?.updated_at||0),startedAt:Number(state?.started_at||0)}},200,origin);
}
async function adminSchedule(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  if(request.method==="GET")return publicSchedule(request,env,origin);
  const b=await body(request),items=Array.isArray(b.items)?b.items:[];
  const clean=[];
  let pos=0;
  for(const x of items){
    const videoId=Number(x.videoId);
    const start=String(x.startTime||"00:00").match(/^([01]\d|2[0-3]):[0-5]\d$/)?.[0];
    if(!videoId||!start)continue;
    clean.push({videoId,start,position:pos++});
  }
  const statements=[env.DB.prepare("DELETE FROM video_schedule")];
  const now=Date.now();
  for(const x of clean){
    statements.push(env.DB.prepare("INSERT INTO video_schedule(video_id,start_time,position,enabled,created_at) VALUES(?,?,?,?,?)").bind(x.videoId,x.start,x.position,1,now));
  }
  statements.push(env.DB.prepare("UPDATE channel_control SET updated_at=? WHERE id=1").bind(now));
  if(clean.length<=999){
    await env.DB.batch(statements);
  }else{
    for(let i=0;i<statements.length;i+=400)await env.DB.batch(statements.slice(i,i+400));
  }
  return publicSchedule(request,env,origin);
}
async function viewerHeartbeat(request,env,origin){
  await ensureVideoSchema(env.DB);
  const b=await body(request),id=String(b.viewerId||"").trim().slice(0,80);
  if(!id)return json({error:"viewerId requerido."},400,origin);
  const now=Date.now();
  const old=await env.DB.prepare("SELECT viewer_id FROM viewer_presence WHERE viewer_id=?").bind(id).first();
  if(old)await env.DB.prepare("UPDATE viewer_presence SET last_seen=? WHERE viewer_id=?").bind(now,id).run();
  else await env.DB.prepare("INSERT INTO viewer_presence(viewer_id,last_seen) VALUES(?,?)").bind(id,now).run();
  await env.DB.prepare("DELETE FROM viewer_presence WHERE last_seen<?").bind(now-60000).run();
  return json({ok:true},200,origin);
}
async function adminViewerCount(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  await ensureVideoSchema(env.DB);
  const now=Date.now();
  await env.DB.prepare("DELETE FROM viewer_presence WHERE last_seen<?").bind(now-60000).run();
  const row=await env.DB.prepare("SELECT COUNT(*) AS count FROM viewer_presence WHERE last_seen>=?").bind(now-45000).first();
  return json({ok:true,count:Number(row?.count||0),updatedAt:now},200,origin);
}
async function media(request,env){
  const url=new URL(request.url);
  const key=decodeURIComponent(url.pathname.replace(/^\/media\//,""));
  if(!key)return new Response("Not found",{status:404});
  const bucket=requireR2(env);
  const range=request.headers.get("Range");
  // Pass the browser Range header directly to R2. This avoids downloading
  // the complete video before serving a partial response.
  let object=await bucket.get(key,{range:range?request.headers:undefined});
  if(!object){
    if(range){
      const head=await bucket.head(key);
      if(!head)return new Response("Not found",{status:404});
      return new Response("Requested range is not satisfiable.",{
        status:416,
        headers:{"Content-Range":"bytes */"+String(head.size||0),"Accept-Ranges":"bytes","Access-Control-Allow-Origin":"*"}
      });
    }
    return new Response("Not found",{status:404});
  }
  const h=new Headers();
  object.writeHttpMetadata(h);
  if(!h.get("Content-Type"))h.set("Content-Type","video/mp4");
  h.set("Cache-Control","public, max-age=31536000, immutable");
  h.set("Accept-Ranges","bytes");
  h.set("Access-Control-Allow-Origin","*");
  h.set("Access-Control-Allow-Methods","GET,HEAD,OPTIONS");
  h.set("Access-Control-Expose-Headers","Content-Length,Content-Range,Accept-Ranges,ETag");
  if(object.httpEtag)h.set("ETag",object.httpEtag);

  if(request.method==="HEAD"){
    h.set("Content-Length",String(object.size||0));
    return new Response(null,{status:200,headers:h});
  }

  if(range){
    const m=range.match(/^bytes=(\d+)-(\d*)$/);
    if(!m){
      const head=await bucket.head(key);
      const size=Number(head?.size||object.size||0);
      return new Response("Requested range is not satisfiable.",{
        status:416,
        headers:{...Object.fromEntries(h),"Content-Range":"bytes */"+size}
      });
    }
    const start=Number(m[1]);
    const requestedEnd=m[2]?Number(m[2]):Number(object.size)-1;
    const size=Number(object.size||0);
    const end=Math.min(requestedEnd,size-1);
    if(!size||start<0||start>=size||end<start){
      return new Response("Requested range is not satisfiable.",{
        status:416,
        headers:{...Object.fromEntries(h),"Content-Range":"bytes */"+size}
      });
    }
    h.set("Content-Range","bytes "+start+"-"+end+"/"+size);
    h.set("Content-Length",String(end-start+1));
    return new Response(object.body,{status:206,headers:h});
  }

  h.set("Content-Length",String(object.size||0));
  return new Response(object.body,{status:200,headers:h});
}

async function ensureSchema(db){
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,nick TEXT NOT NULL,nick_norm TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',banned INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,last_message_at INTEGER NOT NULL DEFAULT 0,last_message_text TEXT NOT NULL DEFAULT '',repeat_count INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,nick TEXT NOT NULL,is_admin INTEGER NOT NULL DEFAULT 0,text TEXT NOT NULL,created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS presence (user_id TEXT PRIMARY KEY,nick TEXT NOT NULL,last_seen INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(id DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_presence_seen ON presence(last_seen)")
  ]);
}
async function getUser(db,uid){return db.prepare("SELECT id,email,nick,nick_norm,password_salt,password_hash,role,banned,created_at,last_message_at,last_message_text,repeat_count FROM users WHERE id=?").bind(uid).first();}
async function requireUser(request,env){
  const s=await readSession(request,env);if(!s)return null;
  const u=await getUser(env.DB,s.uid);
  if(u&&u.nick_norm==="MAGICKIDS")return null;
  return u;
}
async function requireChatUser(request,env){
  if(await readAdminSession(request,env))return {id:"admin-pin",email:"",nick:"MAGICKIDS",role:"admin",banned:0};
  return await requireUser(request,env);
}
async function requireAdmin(request,env){
  if(await readAdminSession(request,env))return {id:"admin-pin",email:"",nick:"MAGICKIDS",role:"admin",banned:0};
  return null;
}
function publicUser(u){return u?{id:u.id,email:u.email,nick:u.nick,isAdmin:u.id==="admin-pin"}:null;}

async function register(request,env,origin){
  if(!env.SESSION_SECRET){
    return json({error:"Falta configurar SESSION_SECRET en el Worker de Cloudflare."},500,origin);
  }
  const b=await body(request),email=String(b.email||"").trim().toLowerCase(),nick=String(b.nick||"").trim().replace(/\s+/g," ").slice(0,24),password=String(b.password||"");
  if(!validNick(nick))return json({error:"El nick debe tener entre 3 y 24 caracteres."},400,origin);
  if(normalizeNick(nick).includes("MAGIC"))return json({error:"Ese nick está reservado. No se permite usar MAGIC ni MAGIC KIDS."},409,origin);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"El correo electrónico no es válido."},400,origin);
  if(password.length<6)return json({error:"La contraseña debe tener al menos 6 caracteres."},400,origin);
  const norm=normalizeNick(nick);
  if(norm==="MAGICKIDS")return json({error:"El nick MAGICKIDS está reservado exclusivamente para el administrador."},409,origin);
  if(await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first())return json({error:"Ese correo ya está registrado."},409,origin);
  if(await env.DB.prepare("SELECT id FROM users WHERE nick_norm=?").bind(norm).first())return json({error:"Ese nick ya está ocupado."},409,origin);

  const pass=await makePasswordRecord(password),uid=crypto.randomUUID(),now=Date.now(),role="user";
  try{
    const token=await makeSession(uid,env.SESSION_SECRET);
    await env.DB.prepare("INSERT INTO users (id,email,nick,nick_norm,password_salt,password_hash,role,banned,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(uid,email,nick,norm,pass.salt,pass.hash,role,0,now).run();
    return json({user:publicUser({id:uid,email:email,nick:nick,role:role,banned:0}),token:token},200,origin,{"Set-Cookie":setSessionCookie(token)});
  }catch(e){
    console.error("register error",e);
    const message=String(e&&e.message||"");
    if(/UNIQUE|constraint/i.test(message))return json({error:"Ese correo o nick ya está registrado."},409,origin);
    return json({error:"No se pudo crear la cuenta. Revisá la configuración del chat."},500,origin);
  }
}
async function adminPinLogin(request,env,origin){
  if(!env.ADMIN_PIN)return json({error:"Falta configurar ADMIN_PIN en el Worker de Cloudflare."},500,origin);
  if(!env.SESSION_SECRET)return json({error:"Falta configurar SESSION_SECRET en el Worker de Cloudflare."},500,origin);
  const b=await body(request),pin=String(b.pin||"").trim();
  if(pin.length!==4||pin.split("").some(ch=>ch<"0"||ch>"9")||pin!==String(env.ADMIN_PIN).trim())return json({error:"Código incorrecto."},401,origin);
  const token=await makeAdminSession(env.SESSION_SECRET);
  return json({user:{id:"admin-pin",email:"",nick:"MAGICKIDS",isAdmin:true},token:token},200,origin,{"Set-Cookie":setAdminSessionCookie(token)});
}
async function adminMasterLogin(request,env,origin){
  if(!env.ADMIN_MASTER_CODE)return json({error:"Falta configurar ADMIN_MASTER_CODE en el Worker de Cloudflare."},500,origin);
  const b=await body(request),code=String(b.code||"").trim();
  const master=String(env.ADMIN_MASTER_CODE).trim();
  if(!code||code!==master)return json({error:"Código maestro incorrecto."},401,origin);
  const token=await makeAdminSession(env.SESSION_SECRET);
  return json({user:{id:"admin-master",email:"",nick:"MAGICKIDS",isAdmin:true},token:token},200,origin,{"Set-Cookie":setAdminSessionCookie(token)});
}
async function login(request,env,origin){
  const b=await body(request),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
  const u=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
  if(!u||!(await verifyPassword(password,u.password_salt,u.password_hash)))return json({error:"Correo o contraseña incorrectos."},401,origin);
  if(u.nick_norm==="MAGICKIDS"||String(u.nick_norm||"").includes("MAGIC"))return json({error:"Ese usuario no puede ingresar al chat con ese nick. MAGIC está reservado."},403,origin);
  if(u.banned)return json({error:"Tu cuenta está bloqueada del chat."},403,origin);
  const token=await makeSession(u.id,env.SESSION_SECRET);
  return json({user:publicUser(u),token:token},200,origin,{"Set-Cookie":setSessionCookie(token)});
}
async function messages(request,env,origin){
  if(!await requireChatUser(request,env))return json({error:"Sesión requerida."},401,origin);
  const u=new URL(request.url),limit=Math.min(100,Math.max(10,Number(u.searchParams.get("limit")||80)));
  const rows=await env.DB.prepare("SELECT id,user_id,nick,is_admin,text,created_at FROM messages ORDER BY id DESC LIMIT ?").bind(limit).all();
  return json({messages:(rows.results||[]).reverse().map(function(r){return {id:r.id,userId:r.user_id,nick:r.nick,isAdmin:r.user_id==="admin-pin"&&!!r.is_admin,text:r.text,createdAt:r.created_at};})},200,origin);
}
async function sendMessage(request,env,origin){
  const u=await requireChatUser(request,env);if(!u)return json({error:"Sesión requerida."},401,origin);if(u.banned)return json({error:"Tu cuenta está bloqueada."},403,origin);
  const b=await body(request),text=cleanText(b.text);if(!text)return json({error:"El mensaje está vacío."},400,origin);
  const now=Date.now(),isAdmin=await readAdminSession(request,env);
  if(!isAdmin){
    if(u.last_message_at&&now-u.last_message_at<3000)return json({error:"Esperá 3 segundos antes de enviar otro mensaje."},429,origin);
    const repeat=text===u.last_message_text?(u.repeat_count||0)+1:0;if(repeat>=2)return json({error:"No podés repetir el mismo mensaje varias veces seguidas."},429,origin);
    await env.DB.prepare("INSERT INTO messages (user_id,nick,is_admin,text,created_at) VALUES (?,?,?,?,?)").bind(u.id,u.nick,0,text,now).run();
    await env.DB.prepare("UPDATE users SET last_message_at=?,last_message_text=?,repeat_count=? WHERE id=?").bind(now,text,repeat,u.id).run();
  }else{
    await env.DB.prepare("INSERT INTO messages (user_id,nick,is_admin,text,created_at) VALUES (?,?,?,?,?)").bind("admin-pin","MAGICKIDS",1,text,now).run();
  }
  return json({ok:true},200,origin);
}
async function heartbeat(request,env,origin){
  const u=await requireChatUser(request,env);if(!u)return json({error:"Sesión requerida."},401,origin);
  await env.DB.prepare("INSERT INTO presence (user_id,nick,last_seen) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET nick=excluded.nick,last_seen=excluded.last_seen").bind(u.id,u.nick,Date.now()).run();
  return json({ok:true},200,origin);
}
async function online(request,env,origin){
  if(!await requireChatUser(request,env))return json({error:"Sesión requerida."},401,origin);
  const cutoff=Date.now()-20000;await env.DB.prepare("DELETE FROM presence WHERE last_seen<?").bind(cutoff).run();
  const row=await env.DB.prepare("SELECT COUNT(*) AS count FROM presence").first();
  return json({count:Number(row&&row.count||0)},200,origin);
}
async function adminDelete(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const id=Number((await body(request)).id);if(!id)return json({error:"Mensaje inválido."},400,origin);
  await env.DB.prepare("DELETE FROM messages WHERE id=?").bind(id).run();return json({ok:true},200,origin);
}
async function adminBan(request,env,origin){
  const admin=await requireAdmin(request,env);if(!admin)return json({error:"No autorizado."},403,origin);
  const uid=String((await body(request)).userId||"");if(!uid||uid===admin.id)return json({error:"Usuario inválido."},400,origin);
  const u=await getUser(env.DB,uid);if(!u)return json({error:"Usuario no encontrado."},404,origin);if(u.role==="admin")return json({error:"No se puede bloquear al administrador."},400,origin);
  await env.DB.prepare("UPDATE users SET banned=1 WHERE id=?").bind(uid).run();await env.DB.prepare("DELETE FROM presence WHERE user_id=?").bind(uid).run();return json({ok:true},200,origin);
}

export default {
  async fetch(request,env){
    const origin=request.headers.get("Origin")||"";
    if(request.method==="OPTIONS")return cors(request);
    try{
      await ensureSchema(env.DB);
      await ensureVideoSchema(env.DB);
      const path=new URL(request.url).pathname;
      if(path.startsWith("/media/")&&(request.method==="GET"||request.method==="HEAD"))return media(request,env);
      if(path==="/api/health"&&request.method==="GET")return json({ok:true,service:"Magic Kids Chat API",database:true,sessionConfigured:!!env.SESSION_SECRET},200,origin);
      if(path==="/")return json({ok:true,service:"Magic Kids Chat API"},200,origin);
      if(path==="/api/register"&&request.method==="POST")return register(request,env,origin);
      if(path==="/api/admin/login"&&request.method==="POST")return adminPinLogin(request,env,origin);
      if(path==="/api/admin/master-login"&&request.method==="POST")return adminMasterLogin(request,env,origin);
      if(path==="/api/login"&&request.method==="POST")return login(request,env,origin);
      if(path==="/api/logout"&&request.method==="POST"){const resp=json({ok:true},200,origin,{"Set-Cookie":clearAdminSessionCookie()});resp.headers.append("Set-Cookie",clearSessionCookie());return resp;}
      if(path==="/api/me"&&request.method==="GET"){if(await readAdminSession(request,env))return json({user:{id:"admin-pin",email:"",nick:"MAGICKIDS",isAdmin:true}},200,origin);const u=await requireUser(request,env);return json({user:publicUser(u)},200,origin);}
      if(path==="/api/messages"&&request.method==="GET")return messages(request,env,origin);
      if(path==="/api/messages"&&request.method==="POST")return sendMessage(request,env,origin);
      if(path==="/api/heartbeat"&&request.method==="POST")return heartbeat(request,env,origin);
      if(path==="/api/online"&&request.method==="GET")return online(request,env,origin);
      if(path==="/api/admin/delete"&&request.method==="POST")return adminDelete(request,env,origin);
      if(path==="/api/admin/ban"&&request.method==="POST")return adminBan(request,env,origin);
      if(path==="/api/videos"&&request.method==="GET")return adminVideos(request,env,origin);
      if(path==="/api/admin/repair-r2-keys"&&request.method==="POST")return adminRepairR2Keys(request,env,origin);
      if(path==="/api/admin/categories"&&request.method==="GET")return adminCategories(request,env,origin);
      if(path==="/api/admin/categories"&&request.method==="POST")return adminCategories(request,env,origin);
      if(path==="/api/admin/upload"&&request.method==="POST")return adminUpload(request,env,origin);
      if(path==="/api/admin/upload/initiate"&&request.method==="POST")return adminUploadInitiate(request,env,origin);
      if(path==="/api/admin/upload/part"&&request.method==="PUT")return adminUploadPart(request,env,origin);
      if(path==="/api/admin/upload/complete"&&request.method==="POST")return adminUploadComplete(request,env,origin);
      if(path==="/api/admin/upload/abort"&&request.method==="POST")return adminUploadAbort(request,env,origin);
      if(path==="/api/admin/video/delete"&&request.method==="POST")return adminDeleteVideo(request,env,origin);
      if(path==="/api/admin/video/category"&&request.method==="POST")return adminVideoCategory(request,env,origin);
      if(path==="/api/admin/video/durations"&&request.method==="POST")return adminVideoDurations(request,env,origin);
      if(path==="/api/admin/video/category-order"&&request.method==="POST")return adminVideoCategoryOrder(request,env,origin);
      if(path==="/api/channel/state"&&request.method==="GET")return channelState(request,env,origin);
      if(path==="/api/admin/m3u8"&&request.method==="GET")return adminM3u8(request,env,origin);
      if(path==="/magic-kids-app.mp4"&&request.method==="GET")return appCurrentVideo(request,env);
      if(path==="/magic-kids.m3u8"&&request.method==="GET")return ownPlaylist(request,env);
      if(path==="/api/admin/channel"&&request.method==="POST")return adminChannelControl(request,env,origin);
      if(path==="/api/schedule"&&request.method==="GET")return publicSchedule(request,env,origin);
      if(path==="/api/viewers/heartbeat"&&request.method==="POST")return viewerHeartbeat(request,env,origin);
      if(path==="/api/live-overlay"&&request.method==="GET")return getLiveOverlay(request,env,origin);
      if(path==="/api/admin/live-overlay"&&request.method==="POST")return adminLiveOverlay(request,env,origin);
      if(path==="/api/admin/viewers"&&request.method==="GET")return adminViewerCount(request,env,origin);
      if(path==="/api/admin/schedule"&&(request.method==="GET"||request.method==="POST"))return adminSchedule(request,env,origin);
      return json({error:"Ruta no encontrada."},404,origin);
    }catch(e){return json({error:"Error interno del chat."},500,origin);}
  }
};