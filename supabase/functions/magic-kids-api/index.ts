import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUNNY_STORAGE_ZONE = Deno.env.get("BUNNY_STORAGE_ZONE")!;
const BUNNY_STORAGE_PASSWORD = Deno.env.get("BUNNY_STORAGE_PASSWORD")!;
const BUNNY_PULL_ZONE = Deno.env.get("BUNNY_PULL_ZONE")!;
const ADMIN_PANEL_KEY = Deno.env.get("ADMIN_PANEL_KEY")!;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function cors() {
  return {
    "Access-Control-Allow-Origin": "https://magickidsok.online",
    "Access-Control-Allow-Headers": "authorization, x-panel-key, content-type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
}
function json(data: unknown, status=200) {
  return new Response(JSON.stringify(data), {status, headers:{"Content-Type":"application/json",...cors()}});
}
function authorized(req: Request) {
  return req.headers.get("x-panel-key") === ADMIN_PANEL_KEY;
}

Deno.serve(async req => {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors()});
  const u=new URL(req.url);
  if(u.pathname.endsWith("/health")) return json({ok:true,service:"Magic Kids independent backend",range206:true});
  if(u.pathname.endsWith("/viewers/heartbeat") && req.method==="POST"){
    const {viewerId}=await req.json();
    if(!viewerId) return json({error:"viewerId required"},400);
    await db.from("mk_viewers").upsert({viewer_id:String(viewerId),last_seen_at:new Date().toISOString()});
    await db.from("mk_viewers").delete().lt("last_seen_at",new Date(Date.now()-90000).toISOString());
    const {count}=await db.from("mk_viewers").select("*",{count:"exact",head:true});
    return json({viewers:count||0});
  }
  if(u.pathname.endsWith("/viewers/count") && req.method==="GET"){
    await db.from("mk_viewers").delete().lt("last_seen_at",new Date(Date.now()-90000).toISOString());
    const {count}=await db.from("mk_viewers").select("*",{count:"exact",head:true});
    return json({viewers:count||0});
  }

  if(!authorized(req)) return json({error:"Acceso no autorizado"},401);

  if(u.pathname.endsWith("/videos") && req.method==="GET"){
    const {data,error}=await db.from("mk_videos").select("*,mk_categories(name,slug)").order("sort_order").order("created_at",{ascending:false});
    if(error) return json({error:error.message},500);
    return json({videos:data||[]});
  }

  if(u.pathname.endsWith("/categories") && req.method==="GET"){
    const {data,error}=await db.from("mk_categories").select("*").order("sort_order");
    if(error) return json({error:error.message},500);
    return json({categories:data||[]});
  }

  return json({error:"Not found"},404);
});
