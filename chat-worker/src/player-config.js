const PLAYER_CONFIG_DEFAULTS = {
  streamUrl: "https://kali.vdopanel.com:3053/stream/play.m3u8",
  logoUrl: "https://static.wixstatic.com/media/f12d15_4db68cd52ff24c48aa1396aec2badbfd~mv2.png",
  logoRight: 10,
  logoTop: 9,
  logoScale: 1
};

async function ensurePlayerConfigSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS mk_player_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    stream_url TEXT NOT NULL,
    logo_url TEXT NOT NULL,
    logo_right REAL NOT NULL DEFAULT 10,
    logo_top REAL NOT NULL DEFAULT 9,
    logo_scale REAL NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare(`INSERT OR IGNORE INTO mk_player_config
    (id, stream_url, logo_url, logo_right, logo_top, logo_scale, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, 0)`)
    .bind(PLAYER_CONFIG_DEFAULTS.streamUrl, PLAYER_CONFIG_DEFAULTS.logoUrl,
      PLAYER_CONFIG_DEFAULTS.logoRight, PLAYER_CONFIG_DEFAULTS.logoTop,
      PLAYER_CONFIG_DEFAULTS.logoScale).run();
}

function playerConfigDto(row) {
  return {
    streamUrl: String(row.stream_url),
    logoUrl: String(row.logo_url),
    logoRight: Number(row.logo_right),
    logoTop: Number(row.logo_top),
    logoScale: Number(row.logo_scale),
    updatedAt: Number(row.updated_at || 0)
  };
}

async function readPlayerConfig(db) {
  await ensurePlayerConfigSchema(db);
  const row = await db.prepare(`SELECT stream_url, logo_url, logo_right, logo_top, logo_scale, updated_at
    FROM mk_player_config WHERE id = 1`).first();
  return playerConfigDto(row);
}

function httpsUrl(value, label, requireM3u8) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error(`${label} debe ser una URL válida.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${label} debe usar HTTPS y no incluir credenciales.`);
  }
  if (requireM3u8 && !parsed.pathname.toLowerCase().endsWith(".m3u8")) {
    throw new Error("La URL de transmisión debe terminar en .m3u8.");
  }
  return parsed.href;
}

function boundedNumber(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} debe estar entre ${min} y ${max}.`);
  }
  return number;
}

export async function playerConfigFetch(request, env, origin, helpers) {
  const path = new URL(request.url).pathname;
  const isPublic = path === "/api/player/config" && request.method === "GET";
  const isAdmin = path === "/api/admin/player/config" &&
    (request.method === "GET" || request.method === "POST");
  if (!isPublic && !isAdmin) return null;

  if (isAdmin && !await helpers.auth(request)) {
    return helpers.json({ ok: false, error: "Panel de reproductor no autorizado." }, 403, origin);
  }

  if (request.method === "GET") {
    const config = await readPlayerConfig(env.DB);
    return helpers.json({ ok: true, config }, 200, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return helpers.json({ ok: false, error: "El contenido enviado no es JSON válido." }, 400, origin);
  }

  let next;
  try {
    next = {
      streamUrl: httpsUrl(body.streamUrl, "La URL de transmisión", true),
      logoUrl: httpsUrl(body.logoUrl, "La URL del logo", false),
      logoRight: boundedNumber(body.logoRight, "La posición horizontal", 0, 300),
      logoTop: boundedNumber(body.logoTop, "La posición vertical", 0, 200),
      logoScale: boundedNumber(body.logoScale, "El tamaño del logo", 0.5, 3)
    };
  } catch (error) {
    return helpers.json({ ok: false, error: error.message }, 400, origin);
  }

  await ensurePlayerConfigSchema(env.DB);
  const updatedAt = Date.now();
  await env.DB.prepare(`UPDATE mk_player_config SET stream_url = ?, logo_url = ?,
    logo_right = ?, logo_top = ?, logo_scale = ?, updated_at = ? WHERE id = 1`)
    .bind(next.streamUrl, next.logoUrl, next.logoRight, next.logoTop,
      next.logoScale, updatedAt).run();
  return helpers.json({ ok: true, config: { ...next, updatedAt } }, 200, origin);
}

