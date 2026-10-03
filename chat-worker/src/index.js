const ALLOWED_ORIGINS = new Set(["https://magickidsok.online","https://www.magickidsok.online","https://magickidsok.github.io"]);
const COOKIE = "MKCHAT_SESSION";
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const PASSWORD_ITERATIONS = 120000;

function json(data,status,origin,extraHeaders){
  const h = new Headers(Object.assign({"Content-Type":"application/json; charset=utf-8"},extraHeaders||{}));
  if(origin && /^https?:\\/\\//.test(origin)){h.set("Access-Control-Allow-Origin",origin);h.set("Access-Control-Allow-Credentials","true");h.set("Vary","Origin");}
  return new Response(JSON.stringify(data),{status:status||200,headers:h});
}
function cors(request){
  const origin=request.headers.get("Origin")||"";
  const h={"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Credentials":"true","Access-Control-Max-Age":"86400","Vary":"Origin"};
  if(origin && /^https?:\\/\\//.test(origin))h["Access-Control-Allow-Origin"]=origin;
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
async function requireAdmin(request,env){const u=await requireUser(request,env);return u&&u.role==="admin"&&!u.banned?u:null;}
function publicUser(u){return u?{id:u.id,email:u.email,nick:u.nick,isAdmin:u.role==="admin"&&!u.banned}:null;}

async function register(request,env,origin){
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
    await env.DB.prepare("INSERT INTO users (id,email,nick,nick_norm,password_salt,password_hash,role,banned,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(uid,email,nick,norm,pass.salt,pass.hash,role,0,now).run();
    const token=await makeSession(uid,env.SESSION_SECRET);
    return json({user:publicUser({id:uid,email:email,nick:nick,role:role,banned:0})},200,origin,{"Set-Cookie":setSessionCookie(token)});
  }catch(e){return json({error:"No se pudo crear la cuenta."},500,origin);}
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
      const path=new URL(request.url).pathname;
      if(path==="/")return json({ok:true,service:"Magic Kids Chat API"},200,origin);
      if(path==="/api/register"&&request.method==="POST")return register(request,env,origin);
      if(path==="/api/login"&&request.method==="POST")return login(request,env,origin);
      if(path==="/api/logout"&&request.method==="POST")return json({ok:true},200,origin,{"Set-Cookie":clearSessionCookie()});
      if(path==="/api/me"&&request.method==="GET"){const u=await requireUser(request,env);return json({user:publicUser(u)},200,origin);}
      if(path==="/api/messages"&&request.method==="GET")return messages(request,env,origin);
      if(path==="/api/messages"&&request.method==="POST")return sendMessage(request,env,origin);
      if(path==="/api/heartbeat"&&request.method==="POST")return heartbeat(request,env,origin);
      if(path==="/api/online"&&request.method==="GET")return online(request,env,origin);
      if(path==="/api/admin/delete"&&request.method==="POST")return adminDelete(request,env,origin);
      if(path==="/api/admin/ban"&&request.method==="POST")return adminBan(request,env,origin);
      return json({error:"Ruta no encontrada."},404,origin);
    }catch(e){return json({error:"Error interno del chat."},500,origin);}
  }
};