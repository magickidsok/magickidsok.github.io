(() => {
  "use strict";
  const SB = "https://uifchrnvigkzantaehgz.supabase.co/functions/v1/";
  const M3U8 = "https://kali.vdopanel.com:3053/stream/play.m3u8";
  const $ = id => document.getElementById(id);
  const safeText = value => String(value == null ? "" : value);
  const esc = value => safeText(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function uuid() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "mk-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
  }
  function ensureLocalToken() {
    let token = localStorage.getItem("mk_premium_client_token");
    if (!token) { token = uuid(); localStorage.setItem("mk_premium_client_token", token); }
    return token;
  }
  async function api(url, options) {
    const response = await fetch(url, Object.assign({cache:"no-store"}, options || {}));
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "No se pudo completar la operación.");
    return data;
  }
  function initPlayer() {
    if (!window.videojs || !$("mk-player")) return;
    const player = videojs("mk-player", {responsive:true,fluid:true,controls:true,preload:"none",liveui:true,html5:{vhs:{overrideNative:false}}});
    player.src({src:M3U8,type:"application/x-mpegURL"});
    player.on("loadstart", () => { if ($("player-status")) $("player-status").textContent = "Conectando con la señal en vivo…"; });
    player.on("playing", () => { if ($("player-status")) $("player-status").textContent = "Transmitiendo en vivo · MAGIC KIDS"; });
    player.on("waiting", () => { if ($("player-status")) $("player-status").textContent = "Cargando la señal…"; });
    player.on("error", () => { if ($("player-status")) $("player-status").textContent = "La señal no respondió. Tocá reproducir nuevamente en unos segundos."; });
    player.ready(() => { if ($("player-status")) $("player-status").textContent = "Señal preparada. Tocá reproducir para comenzar."; });
    // Intentionally no polling/reloading of the player: the HLS stream owns its live state.
  }
  async function loadSchedule() {
    const target = $("schedule-preview");
    if (!target) return;
    try {
      const data = await api(SB + "mk-program-schedule?action=read");
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const current = new Date();
      const mins = current.getHours() * 60 + current.getMinutes();
      const sorted = entries.slice().sort((a,b) => String(a.start_time).localeCompare(String(b.start_time)));
      let currentIndex = -1;
      sorted.forEach((row,i) => {
        const parts = String(row.start_time || "00:00").split(":").map(Number);
        if (parts.length === 2 && parts[0] * 60 + parts[1] <= mins) currentIndex = i;
      });
      const actual = sorted.length ? (currentIndex >= 0 ? sorted[currentIndex] : sorted[sorted.length - 1]) : null;
      const next = sorted.length > 1 && actual ? sorted[(sorted.indexOf(actual)+1)%sorted.length] : null;
      if ($("now-title")) $("now-title").textContent = actual ? actual.title : "MAGIC KIDS";
      if ($("later-title")) $("later-title").textContent = next ? next.title : "PRÓXIMAMENTE";
      target.innerHTML = entries.length ? entries.slice(0,5).map(x => '<div class="schedule-row"><time>'+esc(x.start_time)+'</time><strong>'+esc(x.title)+'</strong></div>').join("") :
        '<p class="muted">La programación se está preparando.</p>';
    } catch (_) {
      target.innerHTML = '<p class="muted">Programación temporalmente no disponible.</p>';
    }
  }
  async function loadPoll() {
    const visitor = ensureLocalToken();
    const status = $("poll-status");
    try {
      const data = await api(SB + "mk-favorite-series-poll?visitor_id=" + encodeURIComponent(visitor));
      renderPoll(data);
    } catch (_) { if (status) status.textContent = "No se pudieron cargar los votos. Intentá nuevamente."; }
  }
  function renderPoll(data) {
    const map = {};
    (data.results || []).forEach(x => { map[x.option_key] = x; });
    const k = map.kito_pizzas || {votes:0,percentage:0};
    const h = map.a_jugar_con_hugo || {votes:0,percentage:0};
    $("kito-votes").textContent = Number(k.votes||0) + (Number(k.votes||0)===1 ? " voto" : " votos");
    $("kito-pct").textContent = Number(k.percentage||0) + "%";
    $("kito-bar").style.width = Number(k.percentage||0) + "%";
    $("hugo-votes").textContent = Number(h.votes||0) + (Number(h.votes||0)===1 ? " voto" : " votos");
    $("hugo-pct").textContent = Number(h.percentage||0) + "%";
    $("hugo-bar").style.width = Number(h.percentage||0) + "%";
    const buttons = document.querySelectorAll("[data-vote]");
    buttons.forEach(btn => {
      const active = data.my_vote === btn.dataset.vote;
      btn.classList.toggle("btn-green", active);
      btn.textContent = active ? "✓ VOTASTE" : (btn.dataset.vote==="kito_pizzas" ? "VOTAR KITO PIZZAS" : "VOTAR A JUGAR CON HUGO");
    });
    if ($("poll-status")) $("poll-status").textContent = data.my_vote ? "Tu voto está registrado. Los resultados son públicos." : "Votación pública: elegí una de las dos series.";
  }
  async function submitVote(option) {
    const status = $("poll-status");
    document.querySelectorAll("[data-vote]").forEach(b => b.disabled = true);
    try {
      const data = await api(SB + "mk-favorite-series-poll", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({visitor_id:ensureLocalToken(),option_key:option})});
      renderPoll(data);
    } catch (e) { if(status) status.textContent = e.message || "No se pudo guardar tu voto."; }
    finally { document.querySelectorAll("[data-vote]").forEach(b => b.disabled = false); }
  }
  async function loadChat() {
    const box = $("chat-messages");
    if (!box) return;
    try {
      const data = await api(SB + "mk-public-chat?action=history");
      box.innerHTML = (data.messages || []).map(m =>
        '<div class="chat-message"><div class="chat-meta '+(m.is_admin?'admin':'')+'">'+(m.is_admin?'👑 ':'')+esc(m.nick)+(m.premium && !m.is_admin?' <span class="premium-tag">PREMIUM</span>':'')+
        '<span class="chat-time"> · '+esc(new Date(m.created_at).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}))+'</span></div><div class="chat-text">'+esc(m.message)+'</div></div>'
      ).join("") || '<p class="muted">Todavía no hay mensajes publicados. ¡Bienvenido a MAGIC KIDS!</p>';
      box.scrollTop = box.scrollHeight;
      if ($("chat-state")) $("chat-state").textContent = "CHAT EN LÍNEA";
    } catch (_) {
      if ($("chat-state")) $("chat-state").textContent = "CHAT TEMPORALMENTE NO DISPONIBLE";
      box.innerHTML = '<p class="muted">El historial no está disponible en este momento.</p>';
    }
  }
  async function sendChat(event) {
    event.preventDefault();
    const status = $("chat-status");
    const button = document.querySelector("#chat-form button[type=submit]");
    const nick = ($("chat-username").value || "").trim();
    const message = ($("chat-message").value || "").trim();
    if (!nick || !message) { if(status) status.textContent = "Completá tu usuario Premium y el mensaje."; return; }
    if (!localStorage.getItem("mk_premium_client_token")) {
      if(status) status.textContent = "Para enviar mensajes, registrate en Premium desde el mismo navegador y esperá la aprobación.";
      return;
    }
    if (button) button.disabled = true;
    try {
      await api(SB + "mk-public-chat", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        action:"send",client_token:ensureLocalToken(),nick,message
      })});
      $("chat-message").value = "";
      if(status) status.textContent = "Mensaje enviado.";
      await loadChat();
    } catch (e) {
      if(status) status.textContent = e.message || "Solo los usuarios Premium aprobados pueden enviar mensajes.";
    } finally { if(button) button.disabled = false; }
  }
  async function loadCampaign() {
    const element = $("campaign-status");
    if (!element) return;
    try {
      const data = await api(SB + "mk-premium-shirt-campaign");
      const c = data.campaign || {};
      if (c.enabled && c.expires_at) {
        element.textContent = "Campaña Premium activa hasta " + new Date(c.expires_at).toLocaleString("es-AR");
      } else {
        element.textContent = "La información del sorteo está disponible para toda la comunidad.";
      }
    } catch (_) { element.textContent = "Conocé las condiciones del sorteo de la remera."; }
  }
  function bind() {
    document.querySelectorAll("[data-vote]").forEach(btn => btn.addEventListener("click", () => submitVote(btn.dataset.vote)));
    if ($("chat-form")) $("chat-form").addEventListener("submit", sendChat);
    const savedNick = localStorage.getItem("mk_premium_username") || "";
    if ($("chat-username") && savedNick) $("chat-username").value = savedNick;
    if ($("chat-username")) $("chat-username").addEventListener("change", () => localStorage.setItem("mk_premium_username", $("chat-username").value.trim()));
    if ($("copy-alias")) $("copy-alias").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText("MAGICKIDS.OK"); $("copy-alias").textContent = "ALIAS COPIADO ✓"; }
      catch (_) { window.prompt("Copiá el alias:", "MAGICKIDS.OK"); }
    });
    if ($("share-site")) $("share-site").addEventListener("click", async () => {
      const info = {title:"MAGIC KIDS",text:"Mirá MAGIC KIDS en vivo las 24 horas",url:"https://www.magickidsok.online/"};
      try { if(navigator.share) await navigator.share(info); else { await navigator.clipboard.writeText(info.url); $("share-site").textContent="ENLACE COPIADO ✓"; } }
      catch (_) {}
    });
  }
  function cleanLegacyWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(reg => {
      if (reg.active && /magic-sw|service-worker|sw\.js/.test(reg.active.scriptURL)) reg.unregister().catch(()=>{});
    })).catch(()=>{});
  }
  document.addEventListener("DOMContentLoaded", () => {
    cleanLegacyWorker();
    initPlayer();
    bind();
    loadSchedule();
    loadPoll();
    loadChat();
    loadCampaign();
    // One lightweight refresh for the public chat/poll; the live player is never reloaded.
    setInterval(loadChat, 12000);
    setInterval(loadPoll, 30000);
  });
})();