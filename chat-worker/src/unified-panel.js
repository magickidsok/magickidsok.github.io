const DEFAULT_SCHEDULE = [
  { start_time: "18:39", title: "ESCUELA DE DETECTIVES" },
  { start_time: "19:09", title: "ESTAN ARRESTADOS" },
  { start_time: "19:38", title: "GARFIELD" },
  { start_time: "20:00", title: "EVANGELION" },
  { start_time: "20:27", title: "EL CLUB DEL ANIME" },
  { start_time: "20:45", title: "A JUGAR CON HUGO" },
  { start_time: "21:00", title: "KITO PIZZAS" },
  { start_time: "21:30", title: "LA GARRAPATA" },
  { start_time: "21:51", title: "GRAFITOS" },
  { start_time: "22:19", title: "GUERRERAS MAGICAS" },
  { start_time: "23:00", title: "HALCONES GALACTICOS" },
  { start_time: "23:30", title: "EL INSPECTOR GATGET" }
];

const PANEL_TABLES = [
  "CREATE TABLE IF NOT EXISTS mk_unified_schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, start_time TEXT NOT NULL UNIQUE, title TEXT NOT NULL, position INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS mk_unified_panel_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS mk_unified_presence (session_id TEXT PRIMARY KEY, page TEXT NOT NULL DEFAULT '', last_seen INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS mk_unified_raffle_entries (id TEXT PRIMARY KEY, username TEXT NOT NULL, username_norm TEXT NOT NULL, email TEXT NOT NULL, facebook_groups INTEGER NOT NULL, shared_confirmed INTEGER NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_mk_unified_raffle_created ON mk_unified_raffle_entries(created_at DESC)",
  "CREATE TABLE IF NOT EXISTS mk_unified_bubbaloo_entries (id TEXT PRIMARY KEY, username TEXT NOT NULL, username_norm TEXT NOT NULL, answer TEXT NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_mk_unified_bubbaloo_created ON mk_unified_bubbaloo_entries(created_at DESC)"
];

async function getConfig(db, key, fallback) {
  const row = await db.prepare("SELECT value FROM mk_unified_panel_config WHERE key=?").bind(key).first();
  return row && row.value ? String(row.value) : fallback;
}

async function setConfig(db, key, value) {
  await db.prepare("INSERT INTO mk_unified_panel_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, String(value)).run();
}

function isValidTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function cleanSchedule(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000) return null;
  const seen = new Set();
  const clean = [];
  for (const item of rows) {
    const start_time = String(item && (item.start_time || item.time) || "").trim();
    const title = String(item && item.title || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!isValidTime(start_time) || !title || /https?:\/\/|www\.|(?:\+?\d[\s().-]*){8,}/i.test(title) || seen.has(start_time)) return null;
    seen.add(start_time);
    clean.push({ start_time, title });
  }
  return clean.sort((a, b) => a.start_time.localeCompare(b.start_time));
}

function isoTime(value) {
  const numeric = Number(value || 0);
  return numeric > 0 ? new Date(numeric).toISOString() : null;
}

async function loadSchedule(db) {
  const rows = await db.prepare("SELECT start_time,title FROM mk_unified_schedule ORDER BY position,start_time").all();
  return rows.results || [];
}

async function loadAnnouncement(db, includeExpired) {
  const raw = await getConfig(db, "announcement", "");
  if (!raw) return null;
  try {
    const announcement = JSON.parse(raw);
    const active = !!announcement.enabled && (!announcement.startsAt || Date.parse(announcement.startsAt) <= Date.now()) && (!announcement.expiresAt || Date.parse(announcement.expiresAt) > Date.now());
    return includeExpired || active ? announcement : null;
  } catch (error) {
    return null;
  }
}

async function jsonPanelState(db, normalizeNick) {
  const [schedule, scheduleUpdatedAt, announcement, requests, users, messages, bans, presence, raffle, bubbaloo] = await Promise.all([
    loadSchedule(db),
    getConfig(db, "schedule_updated_at", ""),
    loadAnnouncement(db, true),
    db.prepare("SELECT id,username,status,created_at,updated_at FROM mk_premium_chat_requests ORDER BY created_at DESC LIMIT 1000").all(),
    db.prepare("SELECT username FROM mk_premium_chat_users ORDER BY username COLLATE NOCASE").all(),
    db.prepare("SELECT id,username,text,is_admin,created_at FROM mk_premium_chat_messages ORDER BY id DESC LIMIT 200").all(),
    db.prepare("SELECT username FROM mk_premium_chat_bans ORDER BY username COLLATE NOCASE").all(),
    db.prepare("SELECT COUNT(*) AS count FROM mk_unified_presence WHERE last_seen>=?").bind(Date.now() - 90000).first(),
    db.prepare("SELECT id,username,email,facebook_groups,shared_confirmed,created_at FROM mk_unified_raffle_entries ORDER BY created_at DESC LIMIT 5000").all(),
    db.prepare("SELECT id,username,answer,created_at FROM mk_unified_bubbaloo_entries ORDER BY created_at DESC LIMIT 5000").all()
  ]);
  const requestRows = requests.results || [];
  const premiumRequests = requestRows.map(function (row) {
    return { id: String(row.id), username: String(row.username), status: String(row.status), createdAt: isoTime(row.created_at), updatedAt: isoTime(row.updated_at) };
  });
  const messageRows = (messages.results || []).reverse().map(function (row) {
    return { id: Number(row.id), username: String(row.username), text: String(row.text), isAdmin: Number(row.is_admin) === 1, createdAt: Number(row.created_at) };
  });
  const rejectedUsers = [...new Set(requestRows.filter(function (row) { return row.status === "rejected"; }).map(function (row) { return String(row.username); }))];
  return {
    ok: true,
    state: {
      schedule,
      scheduleUpdatedAt: scheduleUpdatedAt || null,
      requests: premiumRequests,
      approvedUsers: (users.results || []).map(function (row) { return String(row.username); }),
      rejectedUsers,
      bannedUsers: (bans.results || []).map(function (row) { return String(row.username); }),
      messages: messageRows,
      presenceCount: Number(presence && presence.count || 0),
      announcement,
      raffleEntries: (raffle.results || []).map(function (row) {
        return { id: String(row.id), username: String(row.username), email: String(row.email), facebookGroups: Number(row.facebook_groups), sharedConfirmed: Number(row.shared_confirmed) === 1, createdAt: isoTime(row.created_at) };
      }),
      bubbalooEntries: (bubbaloo.results || []).map(function (row) {
        return { id: String(row.id), username: String(row.username), answer: String(row.answer), createdAt: isoTime(row.created_at) };
      })
    }
  };
}

export async function ensureUnifiedPanelSchema(db) {
  await db.batch(PANEL_TABLES.map(function (sql) { return db.prepare(sql); }));
  const count = await db.prepare("SELECT COUNT(*) AS count FROM mk_unified_schedule").first();
  if (Number(count && count.count || 0) === 0) {
    const seed = DEFAULT_SCHEDULE.map(function (row, index) {
      return db.prepare("INSERT OR IGNORE INTO mk_unified_schedule(start_time,title,position) VALUES(?,?,?)").bind(row.start_time, row.title, index);
    });
    await db.batch(seed);
    await setConfig(db, "schedule_updated_at", new Date().toISOString());
  }
}

export async function unifiedPanelFetch(request, env, origin, helpers) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;
  const json = helpers.json;
  const auth = helpers.auth;
  const validNick = helpers.validNick;
  const normalizeNick = helpers.normalizeNick;
  const readBody = async function () {
    try { return await request.json(); } catch (error) { return {}; }
  };
  const denied = async function () {
    if (await auth(request)) return null;
    return json({ ok: false, error: "Panel privado no autorizado." }, 403, origin);
  };

  if (path === "/public/schedule" && method === "GET") {
    const schedule = await loadSchedule(db);
    const updatedAt = await getConfig(db, "schedule_updated_at", "");
    return json({ ok: true, schedule, updatedAt: updatedAt || null }, 200, origin);
  }

  if (path === "/public/announcement" && method === "GET") {
    return json({ ok: true, announcement: await loadAnnouncement(db, false) }, 200, origin);
  }

  if (path === "/public/presence" && method === "POST") {
    const body = await readBody();
    const sessionId = String(body.sessionId || "").trim().slice(0, 80);
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(sessionId)) return json({ ok: false, error: "Sesión inválida." }, 400, origin);
    const page = String(body.page || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const now = Date.now();
    await db.prepare("INSERT INTO mk_unified_presence(session_id,page,last_seen) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET page=excluded.page,last_seen=excluded.last_seen").bind(sessionId, page, now).run();
    await db.prepare("DELETE FROM mk_unified_presence WHERE last_seen<?").bind(now - 90000).run();
    const count = await db.prepare("SELECT COUNT(*) AS count FROM mk_unified_presence WHERE last_seen>=?").bind(now - 90000).first();
    return json({ ok: true, count: Number(count && count.count || 0) }, 200, origin);
  }

  if (path === "/public/premium-access" && method === "POST") {
    const body = await readBody();
    const username = String(body.username || "").trim().replace(/\s+/g, " ").slice(0, 24);
    if (!validNick(username)) return json({ ok: false, allowed: false, error: "Ingresá el mismo nombre de usuario que usaste al solicitar Premium." }, 400, origin);
    const norm = normalizeNick(username);
    const ban = await db.prepare("SELECT username FROM mk_premium_chat_bans WHERE username_norm=?").bind(norm).first();
    if (ban) return json({ ok: true, allowed: false, message: "Este usuario no tiene acceso Premium. Contactá al administrador si creés que es un error." }, 200, origin);
    const approved = await db.prepare("SELECT username FROM mk_premium_chat_users WHERE username_norm=?").bind(norm).first();
    if (approved) return json({ ok: true, allowed: true, username: String(approved.username), message: "Acceso Premium confirmado." }, 200, origin);
    const req = await db.prepare("SELECT status FROM mk_premium_chat_requests WHERE username_norm=? ORDER BY created_at DESC LIMIT 1").bind(norm).first();
    if (req && req.status === "pending") return json({ ok: true, allowed: false, pending: true, message: "Tu solicitud está pendiente de aprobación. El administrador debe verificar el pago antes de habilitar el acceso." }, 200, origin);
    if (req && req.status === "rejected") return json({ ok: true, allowed: false, rejected: true, message: "La solicitud de este nombre no está aprobada. Contactá al administrador para consultar el estado." }, 200, origin);
    return json({ ok: true, allowed: false, message: "No encontramos una aprobación Premium para ese nombre. Revisá cómo lo escribiste o esperá la aprobación del administrador." }, 200, origin);
  }

  if (path === "/public/premium-request" && method === "POST") {
    const body = await readBody();
    const username = String(body.username || "").trim().replace(/\s+/g, " ").slice(0, 24);
    if (!validNick(username)) return json({ ok: false, error: "Elegí un nombre válido de 3–24 caracteres. No se permite MAGIC ni MAGIC KIDS." }, 400, origin);
    const norm = normalizeNick(username);
    const banned = await db.prepare("SELECT username FROM mk_premium_chat_bans WHERE username_norm=?").bind(norm).first();
    if (banned) return json({ ok: false, error: "Este usuario no tiene acceso Premium." }, 403, origin);
    const approved = await db.prepare("SELECT username FROM mk_premium_chat_users WHERE username_norm=?").bind(norm).first();
    if (approved) return json({ ok: true, alreadyApproved: true, message: "Ese nombre ya tiene acceso Premium." }, 200, origin);
    const pending = await db.prepare("SELECT id FROM mk_premium_chat_requests WHERE username_norm=? AND status='pending' ORDER BY created_at DESC LIMIT 1").bind(norm).first();
    if (pending) return json({ ok: true, alreadyPending: true, message: "Ya existe una solicitud pendiente para ese nombre." }, 200, origin);
    const id = crypto.randomUUID();
    const now = Date.now();
    const clientToken = String(body.clientToken || body.client_token || "").slice(0, 160);
    await db.prepare("INSERT INTO mk_premium_chat_requests(id,username,username_norm,client_token,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id, username, norm, clientToken, "pending", now, now).run();
    return json({ ok: true, requestId: id, status: "pending", message: "Solicitud enviada. Esperá la aprobación manual después de verificar la transferencia." }, 201, origin);
  }

  if (path === "/public/raffle-entry" && method === "POST") {
    const body = await readBody();
    const username = String(body.username || "").trim().replace(/\s+/g, " ").slice(0, 24);
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const groups = Number(body.facebookGroups);
    if (!validNick(username)) return json({ ok: false, error: "Ingresá el nombre Premium aprobado que usás en MAGIC KIDS." }, 400, origin);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ ok: false, error: "Ingresá un email válido." }, 400, origin);
    if (groups !== 10 || body.sharedConfirmed !== true) return json({ ok: false, error: "Confirmá que compartiste la página de MAGIC KIDS en 10 grupos de Facebook." }, 400, origin);
    const norm = normalizeNick(username);
    const ban = await db.prepare("SELECT username FROM mk_premium_chat_bans WHERE username_norm=?").bind(norm).first();
    const approved = await db.prepare("SELECT username FROM mk_premium_chat_users WHERE username_norm=?").bind(norm).first();
    if (ban || !approved) return json({ ok: false, error: "El nombre todavía no está aprobado como usuario Premium." }, 403, origin);
    const duplicate = await db.prepare("SELECT id,username FROM mk_unified_raffle_entries WHERE lower(email)=? LIMIT 1").bind(email).first();
    if (duplicate) {
      if (normalizeNick(duplicate.username) !== norm) return json({ ok: false, error: "Ese email ya está registrado en el sorteo." }, 409, origin);
      return json({ ok: true, alreadyRegistered: true, message: "Este email ya está inscripto en el sorteo.", entry: { id: String(duplicate.id), username: String(duplicate.username) } }, 200, origin);
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.prepare("INSERT INTO mk_unified_raffle_entries(id,username,username_norm,email,facebook_groups,shared_confirmed,created_at) VALUES(?,?,?,?,?,?,?)").bind(id, String(approved.username), norm, email, 10, 1, now).run();
    return json({ ok: true, message: "Inscripción recibida. El email ya figura en el panel privado de MAGIC KIDS.", entry: { id, username: String(approved.username), createdAt: isoTime(now) } }, 201, origin);
  }

  if (path === "/public/bubbaloo-entry" && method === "POST") {
    const body = await readBody();
    const username = String(body.username || "").trim().replace(/\s+/g, " ").slice(0, 24);
    const answer = String(body.answer || "").trim().toUpperCase().slice(0, 20);
    if (!validNick(username)) return json({ ok: false, error: "Ingresá tu nombre de usuario Premium aprobado." }, 400, origin);
    if (answer !== "365 DIAS") return json({ ok: false, error: "La respuesta correcta es 365 DIAS." }, 400, origin);
    const norm = normalizeNick(username);
    const ban = await db.prepare("SELECT username FROM mk_premium_chat_bans WHERE username_norm=?").bind(norm).first();
    const approved = await db.prepare("SELECT username FROM mk_premium_chat_users WHERE username_norm=?").bind(norm).first();
    if (ban || !approved) return json({ ok: false, error: "Solo los usuarios Premium aprobados pueden participar." }, 403, origin);
    const existing = await db.prepare("SELECT id,username,created_at FROM mk_unified_bubbaloo_entries WHERE username_norm=? LIMIT 1").bind(norm).first();
    if (existing) return json({ ok: true, alreadyRegistered: true, message: "Tu participación ya está registrada en el panel privado.", entry: { id: String(existing.id), username: String(existing.username), createdAt: isoTime(existing.created_at) } }, 200, origin);
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.prepare("INSERT INTO mk_unified_bubbaloo_entries(id,username,username_norm,answer,created_at) VALUES(?,?,?,?,?)").bind(id, String(approved.username), norm, "365 DIAS", now).run();
    return json({ ok: true, message: "¡Participación registrada! Ya figura en el panel privado de MAGIC KIDS.", entry: { id, username: String(approved.username), answer: "365 DIAS", createdAt: isoTime(now) } }, 201, origin);
  }

  if (path === "/admin/state" && method === "GET") {
    const response = await denied();
    if (response) return response;
    return json(await jsonPanelState(db, normalizeNick), 200, origin);
  }

  if (path === "/admin/schedule" && method === "POST") {
    const response = await denied();
    if (response) return response;
    const body = await readBody();
    const schedule = cleanSchedule(body.schedule);
    if (!schedule) return json({ ok: false, error: "Programación inválida. Revisá horas, títulos y que no se repitan horarios." }, 400, origin);
    const statements = [db.prepare("DELETE FROM mk_unified_schedule")];
    for (let index = 0; index < schedule.length; index += 1) {
      const row = schedule[index];
      statements.push(db.prepare("INSERT INTO mk_unified_schedule(start_time,title,position) VALUES(?,?,?)").bind(row.start_time, row.title, index));
    }
    await db.batch(statements);
    const updatedAt = new Date().toISOString();
    await setConfig(db, "schedule_updated_at", updatedAt);
    return json({ ok: true, schedule, updatedAt }, 200, origin);
  }

  if (path === "/admin/announcement" && method === "POST") {
    const response = await denied();
    if (response) return response;
    const body = await readBody();
    const message = String(body.message || "").replace(/\s+/g, " ").trim().slice(0, 180);
    if (body.enabled !== false && !message) return json({ ok: false, error: "Escribí el aviso antes de activarlo." }, 400, origin);
    const durationMinutes = Math.max(1, Math.min(10080, Math.round(Number(body.durationMinutes || 60))));
    const startsAt = new Date().toISOString();
    const announcement = {
      enabled: body.enabled !== false,
      message,
      startsAt,
      expiresAt: new Date(Date.now() + durationMinutes * 60000).toISOString(),
      durationMinutes,
      soundEnabled: body.soundEnabled !== false,
      campaignId: crypto.randomUUID()
    };
    await setConfig(db, "announcement", JSON.stringify(announcement));
    return json({ ok: true, announcement }, 200, origin);
  }

  if (path === "/admin/raffle-entry/delete" && method === "POST") {
    const response = await denied();
    if (response) return response;
    const body = await readBody();
    const id = String(body.id || "").trim().slice(0, 120);
    const result = await db.prepare("DELETE FROM mk_unified_raffle_entries WHERE id=?").bind(id).run();
    if (!id || !Number(result.meta && result.meta.changes || 0)) return json({ ok: false, error: "Inscripción no encontrada." }, 404, origin);
    return json({ ok: true }, 200, origin);
  }

  if (path === "/admin/bubbaloo-entry/delete" && method === "POST") {
    const response = await denied();
    if (response) return response;
    const body = await readBody();
    const id = String(body.id || "").trim().slice(0, 120);
    const result = await db.prepare("DELETE FROM mk_unified_bubbaloo_entries WHERE id=?").bind(id).run();
    if (!id || !Number(result.meta && result.meta.changes || 0)) return json({ ok: false, error: "Participación no encontrada." }, 404, origin);
    return json({ ok: true }, 200, origin);
  }

  if (path === "/admin/requests/clear-rejected" && method === "POST") {
    const response = await denied();
    if (response) return response;
    await db.prepare("DELETE FROM mk_premium_chat_requests WHERE status='rejected'").run();
    return json({ ok: true }, 200, origin);
  }

  return null;
}
