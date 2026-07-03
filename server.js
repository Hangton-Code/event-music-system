// Event Music System — projector QR jukebox.
//
//   /        -> host page (project this; shows QR + player + queue)
//   /guest   -> guest page (phones open this via the QR code)
//
// Flow when a guest requests a song:
//   1. checkPlayable()  — reject deleted/private/nonexistent videos
//   2. moderate()       — Gemini approves/rejects on title+channel (fail-open)
//   3. state.add()      — enqueue; broadcast to all clients over WebSocket

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";

import { searchYouTube, checkPlayable } from "./src/youtube.js";
import { moderate } from "./src/gemini.js";
import { JukeboxState } from "./src/state.js";
import { detectLanIp } from "./src/net.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Minimal .env loader (no dependency) ---------------------------------
const envPath = path.join(__dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const PORT = parseInt(process.env.PORT || "45416", 10);
const LAN_IP = detectLanIp(process.env.HOST_IP);
// PUBLIC_URL (e.g. https://grad-din-music.hangton.net) takes precedence when the
// app runs behind a reverse proxy. Otherwise fall back to LAN IP + port.
const PUBLIC_BASE = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const GUEST_URL = PUBLIC_BASE ? `${PUBLIC_BASE}/guest` : `http://${LAN_IP}:${PORT}/guest`;
// Moderation is opt-in: only runs when explicitly enabled AND a key is present.
const MODERATION_ON =
  String(process.env.ENABLE_MODERATION || "").toLowerCase() === "true" &&
  !!process.env.GEMINI_API_KEY;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const state = new JukeboxState();

// --- HTTP API ------------------------------------------------------------

// Host page bootstrap: guest URL + a QR code pointing at it.
app.get("/api/info", async (_req, res) => {
  try {
    const qr = await QRCode.toDataURL(GUEST_URL, { width: 480, margin: 1 });
    res.json({ guestUrl: GUEST_URL, qr, moderation: MODERATION_ON });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ results: [] });
  try {
    const results = await searchYouTube(q);
    res.json({ results });
  } catch (err) {
    console.error("[search]", err.message);
    res.status(502).json({ error: "Search failed. Try again." });
  }
});

// Guest requests a song.
app.post("/api/request", async (req, res) => {
  const { videoId, title, channel, duration, thumbnail, name } = req.body || {};
  if (!videoId || !title) {
    return res.status(400).json({ ok: false, reason: "Missing song info." });
  }

  // 1. Is the video actually playable?
  const playable = await checkPlayable(videoId);
  if (!playable.ok) {
    return res.json({ ok: false, reason: playable.reason });
  }

  // 2. Moderation (Gemini) — OFF by default. Set ENABLE_MODERATION=true in .env
  //    to turn it back on (requires GEMINI_API_KEY). Fails open when enabled.
  if (MODERATION_ON) {
    const verdict = await moderate({ title, channel });
    if (!verdict.approved) {
      return res.json({ ok: false, reason: verdict.reason });
    }
  }

  // 3. Enqueue.
  const { position } = state.add({ videoId, title, channel, duration, thumbnail, addedBy: name });
  res.json({ ok: true, reason: "Added!", position });
});

// Host page lives at "/".
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "host.html"));
});

// --- WebSocket: real-time queue sync + host controls ---------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(snapshot) {
  const msg = JSON.stringify({ type: "state", state: snapshot });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}
state.onChange = broadcast;

wss.on("connection", (ws) => {
  // Send current state immediately on connect.
  ws.send(JSON.stringify({ type: "state", state: state.snapshot() }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case "ended": // host player finished a track
      case "error": // host player couldn't play (embed-disabled/region-locked)
        if (msg.type === "error") {
          console.warn(`[host] playback error code ${msg.code} on ${msg.videoId} — skipping`);
        }
        state.advance(msg.videoId);
        break;
      case "skip":
        state.skip();
        break;
      case "remove":
        state.remove(msg.id);
        break;
      case "move":
        state.move(msg.id, msg.dir);
        break;
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n  🎶  Event Music System running\n");
  console.log(`  Projector (host) : http://localhost:${PORT}/`);
  console.log(`  Guests scan QR   : ${GUEST_URL}`);
  console.log(
    `  Moderation       : ${MODERATION_ON ? "Gemini ON" : "OFF (accepting all songs)"}\n`
  );
  if (LAN_IP === "127.0.0.1") {
    console.warn("  ⚠  Could not detect a LAN IP — guests on other devices won't reach you.\n");
  }
});
