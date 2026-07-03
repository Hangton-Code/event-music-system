# 🎶 Event Music System

A projector **QR jukebox** for events. Project the host page; guests scan the
on-screen QR code with their phones, search YouTube, and queue songs. Approved
tracks play right on the projected screen — audio goes out through the machine
to the venue's AV system.

```
   Projector (laptop / server)        Guests' phones
  ┌────────────────────┐             ┌──────────────┐
  │  ▶ Now Playing     │   scan QR   │  🔍 search   │
  │  [ YouTube video ] │  ◀───────▶  │  + add song  │
  │  ▣ QR   Up Next ▤▤ │   Wi-Fi     │  live queue  │
  └────────────────────┘             └──────────────┘
            │ audio out → venue AV system
```

## Features

- **No YouTube API key** — search works out of the box (results-page scraping).
- **Accepts all songs by default** — no gatekeeping. Optional Gemini moderation
  can be switched on later (see below).
- **Playability pre-check** — deleted/private videos are rejected before queuing;
  embed-disabled/region-locked videos are auto-skipped by the player.
- **Live queue** over WebSocket on both the projector and every phone.
- **Host controls** — play/pause (`space`), skip (`n`), volume, remove tracks.

## Run locally (Bun)

```bash
bun install
cp .env.example .env      # defaults are fine — moderation is off
bun start
```

Open **http://localhost:45416/** on the machine and drag it to the projector
(fullscreen recommended). Click **Start** once to unlock audio.

## Run on a home server (Docker)

The server builds the image itself from source — no registry, no logins.

```bash
# on the home server (one-time setup)
git clone git@github.com:Hangton-Code/event-music-system.git
cd event-music-system
cp .env.example .env
docker compose up -d --build
```

Then browse to `http://<server-lan-ip>:45416/`. The QR code guests scan points at
the same server, so their phones reach it directly.

### Keeping it updated

**Manual** — whenever new changes land on `main`:

```bash
git pull && docker compose up -d --build
```

**Automatic** — `update.sh` does the pull-and-rebuild only when something
changed. Run it on a schedule with cron. For example, checking every 10 minutes:

```bash
crontab -e
# add this line (fix the path to where you cloned the repo):
*/10 * * * * /home/youruser/event-music-system/update.sh >> /home/youruser/event-music-system/update.log 2>&1
```

That's the fully hands-off setup: push changes to GitHub, the server picks them
up and rebuilds on its own within 10 minutes.

> **Networking note — set `HOST_IP`**
> `docker-compose.yml` publishes the port (`45416:45416`). Because the container
> can't see the server's real LAN IP from behind Docker's network, you **must set
> `HOST_IP` in `.env`** to your server's LAN IP (e.g. `192.168.1.50`) — that's the
> address the QR code sends guests to. Find it on the server with `hostname -I`.

## Optional: turn on Gemini moderation

Off by default. To have Gemini reject non-music / explicit-titled requests:

1. Get a free key at <https://aistudio.google.com/apikey>.
2. In `.env`, set `ENABLE_MODERATION=true` and `GEMINI_API_KEY=...`.
3. Verify the key and list models: `bun run check-gemini`.
4. Set `MODERATION_MODE=strict` for family-friendly-only filtering.

It *fails open*: if Gemini is unavailable, music keeps flowing.

> **Caveat:** Gemini judges on the video's **title and channel only**. It catches
> obvious non-music and explicit *titles*, but not explicit audio hidden under an
> innocent title.

## ⚠️ The #1 thing that breaks at events: the network

Guests' phones must be able to reach the host machine's IP. Many **venue/guest
Wi-Fi networks block device-to-device traffic** ("client isolation"), so the QR
code loads nothing even though everything is configured correctly.

**Reliable fixes (pick one):**

- **Run your own hotspot** — laptop/phone hotspot; have guests join *that*.
- **Bring a cheap travel router** and put everyone on its network.
- Use a venue network you control that allows client-to-client traffic.

The host machine still needs **internet** for YouTube playback (and Gemini, if on).

## How it works

| Path | Purpose |
|------|---------|
| `/` | Host/projector page — player, QR code, queue, controls |
| `/guest` | Mobile page guests open via the QR |
| `GET /api/info` | Guest URL + QR code (data URL) |
| `GET /api/search?q=` | Scrapes YouTube search results |
| `POST /api/request` | Playability check → (optional moderation) → enqueue |
| WebSocket `/` | Broadcasts queue state; receives host controls |

The **server owns the queue** (`src/state.js`). The host page is just a player:
when a track ends or errors, it tells the server, which promotes the next song
and broadcasts the new state to everyone.

## Project layout

```
server.js                  Express + WebSocket server, request pipeline
src/youtube.js             No-key search scraping + oEmbed playability check
src/gemini.js              Gemini moderation (optional, fail-open)
src/state.js               Authoritative in-memory queue
src/net.js                 LAN IP detection
public/host.*              Projector page
public/guest.*             Mobile page
scripts/check-gemini.mjs   List models + test moderation
Dockerfile                 Bun-based image
docker-compose.yml         Home-server deployment (builds locally)
update.sh                  Auto-update: git pull + rebuild if changed
```
