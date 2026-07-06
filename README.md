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
- **Accepts all songs by default** — no gatekeeping. An optional LLM content
  filter (Kimi by default) can be toggled on live from the host page.
- **Song suggestions** — the guest page shows tappable hits across K-pop,
  Cantopop, Mandopop, Western, party, and HK classics genres, reshuffled on demand.
- **Playability pre-check** — deleted/private videos are rejected before queuing;
  embed-disabled/region-locked videos are auto-skipped by the player.
- **Queue guardrails** — duplicate songs, a per-IP request cooldown, and a
  50-song cap keep one guest (or a flaky connection) from spamming the queue.
- **Live queue** over WebSocket on both the projector and every phone.
- **Host controls** — play/pause (`space`), skip (`n`), volume, remove tracks,
  per-guest cooldown, and the event context fed to the AI filter (場景 button),
  so one deployment suits any venue — not just a grad dinner.
- **Host password** — set `HOST_PASSWORD` in `.env` to lock the projector page
  and its controls behind a login (recommended on a public domain).

## Run locally (Bun)

```bash
bun install
cp .env.example .env      # defaults are fine — moderation is off
bun start
```

Open **http://localhost:45416/** on the machine and drag it to the projector
(fullscreen recommended). Click **Start** once to unlock audio.

## Run on a home server (Docker + reverse proxy)

The server builds the image itself from source — no registry, no logins. It runs
behind a reverse proxy that handles the domain and HTTPS.

```bash
# on the home server (one-time setup)
git clone git@github.com:Hangton-Code/event-music-system.git
cd event-music-system
cp .env.example .env          # set PUBLIC_URL to your domain
docker compose up -d --build
```

The container joins the external `reverseproxy` Docker network and exposes port
`45416` on it. Point your reverse proxy at `event-music:45416` for the domain,
and set `PUBLIC_URL` in `.env` to that domain (e.g.
`https://grad-din-music.hangton.net`). The QR code guests scan uses `PUBLIC_URL`.

> The `reverseproxy` network must already exist (it does if your proxy created
> it). If not: `docker network create reverseproxy`.

Then browse to your domain — that's the projector page. Guests scan the QR and
reach the same domain from their phones.

### Keeping it updated

**Push-to-deploy (recommended)** — a self-hosted GitHub Actions runner on the
home server rebuilds automatically on every push to `main`. See
[Auto-deploy setup](#auto-deploy-self-hosted-runner) below.

**Manual** — whenever you want:

```bash
git pull && docker compose up -d --build
```

**Cron (alternative to the runner)** — `update.sh` pulls and rebuilds only when
something changed. Use this *instead of* the runner if you'd rather poll:

```bash
crontab -e
# */10 * * * * /home/youruser/event-music-system/update.sh >> ~/event-music.log 2>&1
```

> Use the runner **or** cron, not both — otherwise a push and a cron tick can
> rebuild on top of each other.

## Auto-deploy (self-hosted runner)

The workflow in `.github/workflows/deploy.yml` runs on a runner installed on the
home server. One-time setup:

1. **Register the runner** — on GitHub: repo → **Settings → Actions → Runners →
   New self-hosted runner**, pick Linux, and run the shown commands **on the home
   server, as the same user that owns your clone**:
   ```bash
   # (in a fresh ~/actions-runner dir, per GitHub's instructions)
   ./config.sh --url https://github.com/Hangton-Code/event-music-system --token <TOKEN>
   sudo ./svc.sh install <youruser>   # run as a service so it survives reboots
   sudo ./svc.sh start
   ```
2. **Docker access** — the runner's user must be able to run Docker:
   `sudo usermod -aG docker <youruser>` (re-login after).
3. **Clone location** — the workflow deploys in `~/event-music-system` by default.
   If your clone is elsewhere, set a repo **Variable** `DEPLOY_DIR` (Settings →
   Actions → Variables) to its path.

Now every `git push` to `main` rebuilds on the server within seconds. Trigger a
deploy manually anytime from the repo's **Actions** tab (**Run workflow**).

> **Security note:** self-hosted runners + a **public** repo need care. This
> workflow only triggers on direct pushes to `main` and manual dispatch (never
> on `pull_request`), so forks can't execute code on your runner. Don't add
> `pull_request` triggers on the self-hosted runner while the repo is public —
> or make the repo private for extra safety.

> **Networking note — set `PUBLIC_URL`**
> Because the QR code is a link guests open on their phones, it must contain the
> public address, not an internal one. Behind the reverse proxy, set `PUBLIC_URL`
> in `.env` to your domain (`https://grad-din-music.hangton.net`). The reverse
> proxy must also forward **WebSocket upgrades** (the live queue uses `wss://`).

## Optional: the content filter (LLM moderation)

Off by default, and **toggled live from the host page** (the 🛡 Filter button).
When on, each request is enriched with the video's **YouTube category,
`isFamilySafe` flag, and description**, then an LLM decides whether to allow it.
Rejected guests see the reason.

Uses any **OpenAI-compatible** API — **Kimi (Moonshot)** by default:

1. Get a key at <https://platform.moonshot.ai>.
2. In `.env`, set `LLM_API_KEY=...` (base URL and model default to Kimi).
   Optionally set `ENABLE_MODERATION=true` to have it start on.
3. Verify the key and list models: `bun run check-llm`.
4. Set `MODERATION_MODE=strict` for family-friendly-only filtering.

Swap providers by changing three values — e.g. DeepSeek
(`https://api.deepseek.com/v1`) or GLM. No code changes.

It *fails open*: no key, an API error, or a timeout all fall back to accepting
the song, so the filter can never stop the music.

> **Caveat:** the filter reads the title, channel, category, and description —
> not the actual audio. It catches non-music and explicit metadata, but not
> explicit lyrics hidden under a clean title/description.

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
src/youtube.js             No-key search scraping, oEmbed check, watch-page details
src/moderation.js          LLM content filter (OpenAI-compatible, optional, fail-open)
src/state.js               Authoritative in-memory queue
src/net.js                 LAN IP detection
public/host.*              Projector page (with filter toggle)
public/guest.*             Mobile page (search + suggestions)
scripts/check-llm.mjs      List models + test moderation
Dockerfile                 Bun-based image
docker-compose.yml         Home-server deployment (builds locally)
update.sh                  Auto-update: git pull + rebuild if changed
```
