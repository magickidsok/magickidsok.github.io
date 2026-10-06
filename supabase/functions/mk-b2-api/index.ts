import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SUPABASE_SERVICE_KEY =
  secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const B2_KEY_ID = Deno.env.get("B2_APPLICATION_KEY_ID_V2") || Deno.env.get("B2_APPLICATION_KEY_ID") || "";
const B2_APP_KEY = Deno.env.get("B2_APPLICATION_KEY_V2") || Deno.env.get("B2_APPLICATION_KEY") || "";
const B2_ENDPOINT = Deno.env.get("B2_S3_ENDPOINT_V2") || Deno.env.get("B2_S3_ENDPOINT") || "";
const B2_BUCKET = Deno.env.get("B2_BUCKET") || "magic-kids-media-1991";
const B2_REGION = Deno.env.get("B2_REGION") || "";
const ADMIN_TOKEN = Deno.env.get("MK_ADMIN_TOKEN") || "";

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-mk-admin-token,authorization",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Cache-Control": "no-store",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });

const requireAdmin = (req: Request) => {
  const token = req.headers.get("x-mk-admin-token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return Boolean(ADMIN_TOKEN) && token === ADMIN_TOKEN;
};

function s3Ready() {
  if (!B2_KEY_ID || !B2_APP_KEY || !B2_ENDPOINT || !B2_REGION) {
    throw new Error("Faltan credenciales B2. Configurá B2_APPLICATION_KEY_ID_V2, B2_APPLICATION_KEY_V2, B2_S3_ENDPOINT_V2 y B2_REGION en Supabase.");
  }
}

function s3() {
  s3Ready();
  return new S3Client({
    region: B2_REGION,
    endpoint: B2_ENDPOINT,
    credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APP_KEY },
    forcePathStyle: false,
  });
}

function publicUrl(key: string) {
  const host = B2_ENDPOINT.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${B2_BUCKET}.${host}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function listVideos(category?: string | null) {
  let q = db
    .from("mk_videos")
    .select("id,title,object_path,category_id,video_type,duration_seconds,file_size,mime_type,sort_order,created_at,mk_categories(name,slug)")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (category) q = q.eq("category_id", category);
  const r = await q;
  if (r.error) throw r.error;
  return (r.data || []).map((v: any) => ({
    ...v,
    public_url: publicUrl(v.object_path),
    category: v.mk_categories?.name || "Otros",
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/functions\/v1\/mk-b2-api/, "") || "/";

  try {
    if (path === "/health" && req.method === "GET") {
      return json({
        ok: true,
        service: "mk-b2-api",
        storage: "Backblaze B2",
        range: "206",
        bucket: B2_BUCKET,
        configured: Boolean(B2_KEY_ID && B2_APP_KEY && B2_ENDPOINT && B2_REGION),
      });
    }

    if (path === "/categories" && req.method === "GET") {
      const r = await db.from("mk_categories").select("*").order("sort_order");
      if (r.error) throw r.error;
      return json({ categories: r.data || [] });
    }

    if (path === "/videos" && req.method === "GET") {
      return json({ videos: await listVideos(url.searchParams.get("category")) });
    }

    if (path === "/schedule" && req.method === "GET") {
      const r = await db
        .from("mk_schedule")
        .select("id,start_time,sort_order,video:mk_videos(id,title,object_path,duration_seconds)")
        .order("sort_order")
        .order("created_at");
      if (r.error) throw r.error;
      return json({
        schedule: (r.data || [])
          .filter((x: any) => x.video)
          .map((x: any) => ({
            ...x,
            video_id: x.video.id,
            title: x.video.title,
            object_path: x.video.object_path,
            public_url: publicUrl(x.video.object_path),
            duration_seconds: x.video.duration_seconds,
          })),
      });
    }

    if (path === "/admin/presign" && req.method === "POST") {
      if (!requireAdmin(req)) return json({ error: "No autorizado" }, 401);
      const d = await req.json().catch(() => ({}));
      const name = String(d.name || "video.mp4").replace(/[^a-zA-Z0-9._-]+/g, "-");
      const categorySlug = String(d.categorySlug || "otros").replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
      const key = `videos/${categorySlug}/${Date.now()}-${crypto.randomUUID()}-${name}`;
      const contentType = String(d.contentType || "video/mp4");
      if (!contentType.startsWith("video/")) return json({ error: "Solo se permiten archivos de video." }, 400);
      const signedUrl = await getSignedUrl(
        s3(),
        new PutObjectCommand({
          Bucket: B2_BUCKET,
          Key: key,
          ContentType: contentType,
          CacheControl: "public, max-age=86400",
        }),
        { expiresIn: 900 },
      );
      return json({ key, signedUrl, publicUrl: publicUrl(key), contentType });
    }

    if (path === "/admin/videos" && req.method === "POST") {
      if (!requireAdmin(req)) return json({ error: "No autorizado" }, 401);
      const d = await req.json().catch(() => ({}));
      const title = String(d.title || "Video").slice(0, 200);
      const objectPath = String(d.objectPath || "");
      const categoryId = d.categoryId || null;
      const duration = Number.isFinite(Number(d.durationSeconds)) ? Math.round(Number(d.durationSeconds)) : null;
      const size = Number.isFinite(Number(d.fileSize)) ? Math.round(Number(d.fileSize)) : null;
      if (!objectPath || !objectPath.startsWith("videos/")) return json({ error: "Ruta de video inválida." }, 400);

      const r = await db.from("mk_videos").insert({
        title,
        object_path: objectPath,
        category_id: categoryId,
        video_type: "mp4",
        duration_seconds: duration,
        file_size: size,
        mime_type: String(d.mimeType || "video/mp4"),
        sort_order: Number(d.sortOrder || 0),
      }).select("id,title,object_path,category_id,video_type,duration_seconds,file_size,mime_type,sort_order,created_at,mk_categories(name,slug)").single();

      if (r.error) return json({ error: r.error.message }, 400);
      return json({ video: { ...r.data, public_url: publicUrl(objectPath) } });
    }

    if (path === "/admin/videos" && req.method === "DELETE") {
      if (!requireAdmin(req)) return json({ error: "No autorizado" }, 401);
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Falta id." }, 400);

      const v = await db.from("mk_videos").select("id,object_path").eq("id", id).single();
      if (v.error) return json({ error: v.error.message }, 404);

      s3Ready();
      await s3().send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: v.data.object_path }));

      await db.from("mk_schedule").delete().eq("video_id", id);
      const d = await db.from("mk_videos").delete().eq("id", id);
      if (d.error) throw d.error;
      return json({ ok: true });
    }

    if (path === "/admin/categories" && req.method === "POST") {
      if (!requireAdmin(req)) return json({ error: "No autorizado" }, 401);
      const d = await req.json().catch(() => ({}));
      const name = String(d.name || "").trim().slice(0, 80);
      const slug = String(d.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 80);
      if (!name || !slug) return json({ error: "Categoría inválida." }, 400);
      const r = await db.from("mk_categories").insert({ name, slug, sort_order: Number(d.sortOrder || 99) }).select().single();
      if (r.error) return json({ error: r.error.message }, 400);
      return json({ category: r.data });
    }

    if (path === "/admin/schedule" && req.method === "POST") {
      if (!requireAdmin(req)) return json({ error: "No autorizado" }, 401);
      const d = await req.json().catch(() => ({}));
      const items = Array.isArray(d.items) ? d.items : [];
      await db.from("mk_schedule").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (items.length) {
        const rows = items.map((x: any, i: number) => ({
          video_id: x.videoId,
          start_time: String(x.startTime || "00:00").slice(0, 5),
          sort_order: i,
        }));
        const r = await db.from("mk_schedule").insert(rows);
        if (r.error) throw r.error;
      }
      return json({ ok: true });
    }

    return json({ error: "Ruta no encontrada." }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Error interno." }, 500);
  }
});