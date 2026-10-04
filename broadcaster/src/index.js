import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const API_URL = (process.env.MAGIC_KIDS_API_URL || "https://magickidsok-github-io.elmagickids.workers.dev").replace(/\/$/, "");
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const CF_TOKEN = process.env.CF_STREAM_API_TOKEN || "";
const CUSTOMER_CODE = process.env.CF_STREAM_CUSTOMER_CODE || "";
const INPUT_ID_FILE = process.env.CF_LIVE_INPUT_ID_FILE || "/data/live-input.json";
const POLL_MS = Number(process.env.POLL_MS || 5000);
const DISCONNECT_TIMEOUT = Number(process.env.CF_STREAM_TIMEOUT_SECONDS || 30);
const VIDEO_TIMEOUT_MS = Number(process.env.VIDEO_TIMEOUT_MS || 0);

let ffmpeg = null;
let current = null;
let stopped = false;
let lastGeneration = -1;
let lastStatus = "stopped";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function mediaUrl(key) {
  return API_URL + "/media/" + String(key).split("/").map(encodeURIComponent).join("/");
}
async function getJson(path) {
  const r = await fetch(API_URL + path, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error("API " + r.status + " " + path);
  return r.json();
}
async function streamApi(path, options={}) {
  const r = await fetch("https://api.cloudflare.com/client/v4" + path, {
    ...options,
    headers: {
      "Authorization": "Bearer " + CF_TOKEN,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await r.json();
  if (!r.ok || !data.success) throw new Error("Cloudflare Stream: " + JSON.stringify(data.errors || data));
  return data.result;
}
async function loadInput() {
  try { return JSON.parse(await fs.readFile(INPUT_ID_FILE, "utf8")); }
  catch { return null; }
}
async function saveInput(v) {
  await fs.mkdir("/data", { recursive: true });
  await fs.writeFile(INPUT_ID_FILE, JSON.stringify(v, null, 2));
}
async function ensureLiveInput() {
  if (!ACCOUNT_ID || !CF_TOKEN || !CUSTOMER_CODE) {
    throw new Error("Faltan CF_ACCOUNT_ID, CF_STREAM_API_TOKEN o CF_STREAM_CUSTOMER_CODE.");
  }
  let input = await loadInput();
  if (!input?.uid || !input?.rtmps?.url || !input?.rtmps?.streamKey) {
    input = await streamApi("/accounts/" + ACCOUNT_ID + "/stream/live_inputs", {
      method: "POST",
      body: JSON.stringify({
        meta: { name: "Magic Kids 24/7" },
        enabled: true,
        recording: { mode: "automatic", timeoutSeconds: DISCONNECT_TIMEOUT }
      })
    });
    await saveInput({
      uid: input.uid,
      rtmps: input.rtmps,
      created: input.created,
      hls: "https://customer-" + CUSTOMER_CODE + ".cloudflarestream.com/" + input.uid + "/manifest/video.m3u8"
    });
  }
  return input;
}
async function stopEncoder() {
  if (!ffmpeg) return;
  try { ffmpeg.kill("SIGTERM"); } catch {}
  ffmpeg = null;
  current = null;
}
async function startVideo(item, input) {
  await stopEncoder();
  const url = mediaUrl(item.object_key);
  console.log("[broadcast] ahora:", item.position, item.title, url);
  const args = [
    "-hide_banner", "-loglevel", "warning",
    "-re", "-i", url,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
    "-pix_fmt", "yuv420p", "-r", "30",
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
    "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
    "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-f", "flv", input.rtmps.url + input.rtmps.streamKey
  ];
  ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  current = item;
  ffmpeg.stderr.on("data", d => process.stderr.write("[ffmpeg] " + d));
  ffmpeg.on("exit", (code, signal) => {
    console.log("[broadcast] ffmpeg terminó", code, signal);
    ffmpeg = null;
  });
}
async function run() {
  console.log("[broadcast] Magic Kids broadcaster iniciado. API:", API_URL);
  const input = await ensureLiveInput();
  console.log("[broadcast] HLS:", input.hls || "ver /data/live-input.json");
  while (true) {
    try {
      const state = await getJson("/api/channel/state");
      const schedule = (await getJson("/api/schedule")).schedule || [];
      if (state.status !== "live") {
        if (ffmpeg) await stopEncoder();
        lastStatus = state.status;
        await sleep(POLL_MS);
        continue;
      }
      if (state.generation !== lastGeneration) {
        lastGeneration = state.generation;
        await stopEncoder();
        current = null;
      }
      if (!schedule.length) {
        await stopEncoder();
        await sleep(POLL_MS);
        continue;
      }
      let idx = current ? schedule.findIndex(x => x.id === current.id) + 1 : 0;
      if (idx < 0 || idx >= schedule.length) idx = 0;
      const item = schedule[idx];
      if (!ffmpeg) await startVideo(item, input);
      await new Promise(resolve => {
        const timer = setInterval(async () => {
          try {
            const s = await getJson("/api/channel/state");
            if (s.status !== "live" || s.generation !== lastGeneration) {
              clearInterval(timer); resolve();
            } else if (!ffmpeg) {
              clearInterval(timer); resolve();
            }
          } catch {}
        }, POLL_MS);
      });
    } catch (e) {
      console.error("[broadcast]", e.message || e);
      await sleep(5000);
    }
  }
}
process.on("SIGTERM", async () => { stopped = true; await stopEncoder(); process.exit(0); });
process.on("SIGINT", async () => { stopped = true; await stopEncoder(); process.exit(0); });
run();
