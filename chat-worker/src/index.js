const ALLOWED_ORIGINS = new Set(["https://magickidsok.online","https://www.magickidsok.online","https://magickidsok.github.io"]);
const COOKIE = "MKCHAT_SESSION";
const ADMIN_COOKIE = "MKADMIN_SESSION";
const ADMIN_SESSION_SECONDS = 60 * 60 * 12;
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const PASSWORD_ITERATIONS = 120000;

function allowedOrigin(origin){
  return ALLOWED_ORIGINS.has(String(origin||""))?String(origin):"";
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
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
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
  const m=(request.headers.get("Cookie")||"").match(new RegExp("(?:^|;\\s*)"+COOKIE+"=([^;]+)"));
  if(!m||!env.SESSION_SECRET)return null;
  const parts=m[1].split(".");if(parts.length!==2)return null;
  try{const body=parts[0],sig=b64ToBytes(parts[1]),expected=await hmac(env.SESSION_SECRET,body);if(!safeEq(sig,expected))return null;const data=decJson(body);if(!data.uid||!data.exp||data.exp<Math.floor(Date.now()/1000))return null;return data;}catch(e){return null;}
}
function setSessionCookie(token){return COOKIE+"="+token+"; Path=/; HttpOnly; Secure; SameSite=None; Max-Age="+SESSION_SECONDS;}
function makeAdminSession(secret){return makeAdminSessionToken(secret);}
async function makeAdminSessionToken(secret){const body=encJson({admin:1,exp:Math.floor(Date.now()/1000)+ADMIN_SESSION_SECONDS});return body+"."+bytesToB64(await hmac(secret,body));}
async function readAdminSession(request,env){
  const m=(request.headers.get("Cookie")||"").match(new RegExp("(?:^|;\\s*)"+ADMIN_COOKIE+"=([^;]+)"));
  if(!m||!env.SESSION_SECRET)return false;
  const parts=m[1].split(".");if(parts.length!==2)return false;
  try{const body=parts[0],sig=b64ToBytes(parts[1]),expected=await hmac(env.SESSION_SECRET,body);if(!safeEq(sig,expected))return false;const data=decJson(body);return !!(data.admin&&data.exp&&data.exp>=Math.floor(Date.now()/1000));}catch(e){return false;}
}
function setAdminSessionCookie(token){return ADMIN_COOKIE+"="+token+"; Path=/; HttpOnly; Secure; SameSite=None; Max-Age="+ADMIN_SESSION_SECONDS;}
function clearAdminSessionCookie(){return ADMIN_COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0";}
function clearSessionCookie(){return COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0";}
function normalizeNick(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9]/g,"").toUpperCase();}
function validNick(v){return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _.-]{3,24}$/.test(v);}
function cleanText(v){return String(v||"").replace(/https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|net|org|es|ar|tv|site)\b/gi,"").replace(/\s+/g," ").trim().slice(0,180);}
async function body(request){try{return await request.json();}catch(e){return {};}}
async function hashPassword(password,saltBytes){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),{name:"PBKDF2"},false,["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt:saltBytes,iterations:PASSWORD_ITERATIONS,hash:"SHA-256"},key,256));
}
async function makePasswordRecord(password){const salt=crypto.getRandomValues(new Uint8Array(16));const hash=await hashPassword(password,salt);return {salt:bytesToB64(salt),hash:bytesToB64(hash)};}
async function verifyPassword(password,saltB64,hashB64){return safeEq(await hashPassword(password,b64ToBytes(saltB64)),b64ToBytes(hashB64));}



function requireR2(env){if(!env.VIDEOS)throw new Error("R2 no configurado: falta el binding VIDEOS.");return env.VIDEOS;}
async function ensureVideoSchema(db){
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS video_categories (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY AUTOINCREMENT,object_key TEXT NOT NULL UNIQUE,title TEXT NOT NULL,category_id INTEGER,thumbnail_key TEXT,video_type TEXT NOT NULL DEFAULT 'program',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS video_schedule (id INTEGER PRIMARY KEY AUTOINCREMENT,video_id INTEGER NOT NULL,start_time TEXT NOT NULL,position INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_video_schedule_position ON video_schedule(position)")
  ]);
  const cols=await db.prepare("PRAGMA table_info(videos)").all();
  if(!(cols.results||[]).some(x=>x.name==="video_type")){
    await db.prepare("ALTER TABLE videos ADD COLUMN video_type TEXT NOT NULL DEFAULT 'program'").run();
  }
}
async function adminVideos(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  const rows=await env.DB.prepare("SELECT v.id,v.object_key,v.title,v.category_id,c.name AS category,v.thumbnail_key,v.video_type,v.created_at,v.updated_at FROM videos v LEFT JOIN video_categories c ON c.id=v.category_id ORDER BY v.id DESC").all();
  return json({videos:rows.results||[],r2Configured:!!env.VIDEOS},200,origin);
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
    const base=rawName.replace(/.[^.]+$/,"").replace(/[_-]+/g," ").replace(/s+/g," ").trim();
    const title=(files.length===1&&requestedTitle?requestedTitle:base||"Video").slice(0,180);
    const name=rawName.replace(/[^A-Za-z0-9._-]/g,"_");
    const key="videos/"+Date.now()+"-"+crypto.randomUUID()+"-"+name;
    const data=await file.arrayBuffer();
    await bucket.put(key,data,{httpMetadata:{contentType:file.type||"video/mp4",cacheControl:"public, max-age=31536000"}});
    const now=Date.now();
    const result=await env.DB.prepare("INSERT INTO videos(object_key,title,category_id,video_type,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(key,title,categoryId,videoType,now,now).run();
    uploaded.push({id:result.meta?.last_row_id||null,key,title,videoType});
  }
  return json({ok:true,count:uploaded.length,uploaded},201,origin);
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
async function publicSchedule(request,env,origin){
  await ensureVideoSchema(env.DB);
  const rows=await env.DB.prepare("SELECT s.id,s.video_id,s.start_time,s.position,s.enabled,v.title,v.object_key,v.thumbnail_key,v.video_type,c.name AS category FROM video_schedule s JOIN videos v ON v.id=s.video_id LEFT JOIN video_categories c ON c.id=v.category_id WHERE s.enabled=1 ORDER BY s.position ASC,s.start_time ASC").all();
  return json({schedule:rows.results||[]},200,origin);
}
async function adminSchedule(request,env,origin){
  if(!await requireAdmin(request,env))return json({error:"No autorizado."},403,origin);
  if(request.method==="GET")return publicSchedule(request,env,origin);
  const b=await body(request),items=Array.isArray(b.items)?b.items:[];
  await env.DB.prepare("DELETE FROM video_schedule").run();
  let pos=0;
  for(const x of items){
    const videoId=Number(x.videoId),start=String(x.startTime||"00:00").match(/^([01]\d|2[0-3]):[0-5]\d$/)?.[0];
    if(!videoId||!start)continue;
    await env.DB.prepare("INSERT INTO video_schedule(video_id,start_time,position,enabled,created_at) VALUES(?,?,?,?,?)").bind(videoId,start,pos++,1,Date.now()).run();
  }
  return publicSchedule(request,env,origin);
}
async function media(request,env){
  const key=decodeURIComponent(new URL(request.url).pathname.replace(/^\/media\//,""));
  if(!key)return new Response("Not found",{status:404});
  const object=await requireR2(env).get(key);
  if(!object)return new Response("Not found",{status:404});
  const h=new Headers();
  object.writeHttpMetadata(h);h.set("Cache-Control","public, max-age=31536000");h.set("Accept-Ranges","bytes");h.set("Access-Control-Allow-Origin","*");h.set("Access-Control-Allow-Methods","GET,HEAD,OPTIONS");
  const range=request.headers.get("Range");
  if(range && object.size){
    const m=range.match(/bytes=(\d+)-(\d*)/);
    if(m){
      const start=Number(m[1]),end=m[2]?Number(m[2]):object.size-1;
      if(start<object.size && start<=end){
        const part=await requireR2(env).get(key,{range:{offset:start,length:end-start+1}});
        h.set("Content-Range","bytes "+start+"-"+end+"/"+object.size);h.set("Content-Length",String(end-start+1));
        return new Response(part.body,{status:206,headers:h});
      }
    }
  }
  h.set("Content-Length",String(object.size||0));return new Response(object.body,{headers:h});
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
async function requireUser(request,env){const s=await readSession(request,env);if(!s)return null;return await getUser(env.DB,s.uid);}
async function requireAdmin(request,env){if(await readAdminSession(request,env))return {id:"admin-pin",email:"",nick:"MAGICKIDS",role:"admin",banned:0};const u=await requireUser(request,env);return u&&u.role==="admin"&&!u.banned?u:null;}
function publicUser(u){return u?{id:u.id,email:u.email,nick:u.nick,isAdmin:u.role==="admin"&&!u.banned}:null;}

async function register(request,env,origin){
  if(!env.SESSION_SECRET){
    return json({error:"Falta configurar SESSION_SECRET en el Worker de Cloudflare."},500,origin);
  }
  const b=await body(request),email=String(b.email||"").trim().toLowerCase(),nick=String(b.nick||"").trim().replace(/\s+/g," ").slice(0,24),password=String(b.password||"");
  if(!validNick(nick))return json({error:"El nick debe tener entre 3 y 24 caracteres."},400,origin);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"El correo electrónico no es válido."},400,origin);
  if(password.length<6)return json({error:"La contraseña debe tener al menos 6 caracteres."},400,origin);
  const norm=normalizeNick(nick),admin=await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
  if(!admin && norm!=="MAGICKIDS")return json({error:"El primer registro debe usar el nick MAGICKIDS."},403,origin);
  if(admin && norm==="MAGICKIDS")return json({error:"El nick MAGICKIDS está reservado para el administrador."},409,origin);
  if(await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first())return json({error:"Ese correo ya está registrado."},409,origin);
  if(await env.DB.prepare("SELECT id FROM users WHERE nick_norm=?").bind(norm).first())return json({error:"Ese nick ya está ocupado."},409,origin);

  const pass=await makePasswordRecord(password),uid=crypto.randomUUID(),now=Date.now(),role=(!admin&&norm==="MAGICKIDS")?"admin":"user";
  try{
    const token=await makeSession(uid,env.SESSION_SECRET);
    await env.DB.prepare("INSERT INTO users (id,email,nick,nick_norm,password_salt,password_hash,role,banned,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(uid,email,nick,norm,pass.salt,pass.hash,role,0,now).run();
    return json({user:publicUser({id:uid,email:email,nick:nick,role:role,banned:0})},200,origin,{"Set-Cookie":setSessionCookie(token)});
  }catch(e){
    console.error("register error",e);
    const message=String(e&&e.message||"");
    if(/UNIQUE|constraint/i.test(message))return json({error:"Ese correo o nick ya está registrado."},409,origin);
    return json({error:"No se pudo crear la cuenta. Revisá la configuración del chat."},500,origin);
  }
}
async function adminPinLogin(request,env,origin){
  if(!env.ADMIN_PIN)return json({error:"Falta configurar ADMIN_PIN en el Worker de Cloudflare."},500,origin);
  const b=await body(request),pin=String(b.pin||"").trim();
  if(pin.length!==4||pin.split("").some(ch=>ch<"0"||ch>"9")||pin!==String(env.ADMIN_PIN).trim())return json({error:"Código incorrecto."},401,origin);
  const token=await makeAdminSession(env.SESSION_SECRET);
  return json({user:{id:"admin-pin",email:"",nick:"MAGICKIDS",isAdmin:true}},200,origin,{"Set-Cookie":setAdminSessionCookie(token)});
}
async function login(request,env,origin){
  const b=await body(request),email=String(b.email||"").trim().toLowerCase(),password=String(b.password||"");
  const u=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
  if(!u||!(await verifyPassword(password,u.password_salt,u.password_hash)))return json({error:"Correo o contraseña incorrectos."},401,origin);
  if(u.banned)return json({error:"Tu cuenta está bloqueada del chat."},403,origin);
  const token=await makeSession(u.id,env.SESSION_SECRET);
  return json({user:publicUser(u)},200,origin,{"Set-Cookie":setSessionCookie(token)});
}
async function messages(request,env,origin){
  if(!await requireUser(request,env))return json({error:"Sesión requerida."},401,origin);
  const u=new URL(request.url),limit=Math.min(100,Math.max(10,Number(u.searchParams.get("limit")||80)));
  const rows=await env.DB.prepare("SELECT id,user_id,nick,is_admin,text,created_at FROM messages ORDER BY id DESC LIMIT ?").bind(limit).all();
  return json({messages:(rows.results||[]).reverse().map(function(r){return {id:r.id,userId:r.user_id,nick:r.nick,isAdmin:!!r.is_admin,text:r.text,createdAt:r.created_at};})},200,origin);
}
async function sendMessage(request,env,origin){
  const u=await requireUser(request,env);if(!u)return json({error:"Sesión requerida."},401,origin);if(u.banned)return json({error:"Tu cuenta está bloqueada."},403,origin);
  const b=await body(request),text=cleanText(b.text);if(!text)return json({error:"El mensaje está vacío."},400,origin);
  const now=Date.now();if(u.last_message_at&&now-u.last_message_at<3000)return json({error:"Esperá 3 segundos antes de enviar otro mensaje."},429,origin);
  const repeat=text===u.last_message_text?(u.repeat_count||0)+1:0;if(repeat>=2)return json({error:"No podés repetir el mismo mensaje varias veces seguidas."},429,origin);
  await env.DB.prepare("INSERT INTO messages (user_id,nick,is_admin,text,created_at) VALUES (?,?,?,?,?)").bind(u.id,u.nick,u.role==="admin"?1:0,text,now).run();
  await env.DB.prepare("UPDATE users SET last_message_at=?,last_message_text=?,repeat_count=? WHERE id=?").bind(now,text,repeat,u.id).run();
  return json({ok:true},200,origin);
}
async function heartbeat(request,env,origin){
  const u=await requireUser(request,env);if(!u)return json({error:"Sesión requerida."},401,origin);
  await env.DB.prepare("INSERT INTO presence (user_id,nick,last_seen) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET nick=excluded.nick,last_seen=excluded.last_seen").bind(u.id,u.nick,Date.now()).run();
  return json({ok:true},200,origin);
}
async function online(request,env,origin){
  if(!await requireUser(request,env))return json({error:"Sesión requerida."},401,origin);
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
      if(path.startsWith("/media/")&&request.method==="GET")return media(request,env);
      if(path==="/api/health"&&request.method==="GET")return json({ok:true,service:"Magic Kids Chat API",database:true,sessionConfigured:!!env.SESSION_SECRET},200,origin);
      if(path==="/")return json({ok:true,service:"Magic Kids Chat API"},200,origin);
      if(path==="/api/register"&&request.method==="POST")return register(request,env,origin);
      if(path==="/api/admin/login"&&request.method==="POST")return adminPinLogin(request,env,origin);
      if(path==="/api/login"&&request.method==="POST")return login(request,env,origin);
      if(path==="/api/logout"&&request.method==="POST")return json({ok:true},200,origin,{"Set-Cookie":clearAdminSessionCookie()});
      if(path==="/api/me"&&request.method==="GET"){if(await readAdminSession(request,env))return json({user:{id:"admin-pin",email:"",nick:"MAGICKIDS",isAdmin:true}},200,origin);const u=await requireUser(request,env);return json({user:publicUser(u)},200,origin);}
      if(path==="/api/messages"&&request.method==="GET")return messages(request,env,origin);
      if(path==="/api/messages"&&request.method==="POST")return sendMessage(request,env,origin);
      if(path==="/api/heartbeat"&&request.method==="POST")return heartbeat(request,env,origin);
      if(path==="/api/online"&&request.method==="GET")return online(request,env,origin);
      if(path==="/api/admin/delete"&&request.method==="POST")return adminDelete(request,env,origin);
      if(path==="/api/admin/ban"&&request.method==="POST")return adminBan(request,env,origin);
      if(path==="/api/videos"&&request.method==="GET")return adminVideos(request,env,origin);
      if(path==="/api/admin/categories"&&request.method==="GET")return adminCategories(request,env,origin);
      if(path==="/api/admin/categories"&&request.method==="POST")return adminCategories(request,env,origin);
      if(path==="/api/admin/upload"&&request.method==="POST")return adminUpload(request,env,origin);
      if(path==="/api/admin/video/delete"&&request.method==="POST")return adminDeleteVideo(request,env,origin);
      if(path==="/api/schedule"&&request.method==="GET")return publicSchedule(request,env,origin);
      if(path==="/api/admin/schedule"&&(request.method==="GET"||request.method==="POST"))return adminSchedule(request,env,origin);
      return json({error:"Ruta no encontrada."},404,origin);
    }catch(e){return json({error:"Error interno del chat."},500,origin);}
  }
};