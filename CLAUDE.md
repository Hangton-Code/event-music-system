# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A projector QR jukebox for events: the host page (`/`) is projected and plays YouTube videos; guests scan the on-screen QR to open `/guest` on their phones, search/browse YouTube, and queue songs. Vanilla JS everywhere — no framework, no bundler, no TypeScript, no tests.

## Commands

Use **bun** (not npm):

```bash
bun install
cp .env.example .env   # defaults are fine; moderation is off
bun start              # runs server.js on port 45416
bun run check-llm      # verify LLM_API_KEY and list available models
```

There is no lint, build, or test step. Verify changes by running the server and exercising both pages (`/` and `/guest`).

## Architecture

**The server owns all state.** `src/state.js` (`JukeboxState`) is the authoritative in-memory queue; every mutation fires `onChange`, and `server.js` broadcasts the full state snapshot to all WebSocket clients. The host page is a dumb player: it renders whatever `nowPlaying` says and reports back `ended`/`error` events, which make the server advance the queue. Host controls (skip/remove/move/filter toggle) also arrive over the same WebSocket. There is no persistence — a restart clears the queue.

**Song request pipeline** (`POST /api/request` in `server.js`):
1. `checkPlayable()` — YouTube oEmbed check rejects deleted/private videos (fails open on network errors; the host player auto-skips iframe error codes 101/150 as backstop for embed-disabled/region-locked videos).
2. `moderate()` — optional LLM filter, only when toggled on from the host page.
3. `state.add()` — enqueue and broadcast.

**YouTube without an API key** (`src/youtube.js`): search scrapes the public results page and parses `ytInitialData`; video details for moderation come from the watch page's `ytInitialPlayerResponse`. The `SOCS/CONSENT` cookie avoids the EU consent wall. If search breaks, suspect YouTube layout changes. `/api/browse` (guest page genre tabs/singer chips) is the same search but cached 30 min per query and filtered to singles (≤10 min) to exclude compilation videos.

**Moderation fail-open vs fail-closed** (`src/moderation.js`) — this distinction is deliberate, preserve it:
- **Fail-open** (approve) for infrastructure failures only: missing API key, HTTP error, timeout. A moderation outage must never stop the music.
- **Fail-closed** (reject) when the model answers but dodges: provider `content_filter` finish reason, or a reply without valid `{"approved": boolean}` JSON. This catches e.g. banned protest songs that Chinese-hosted models refuse to discuss.

The LLM is any OpenAI-compatible chat API, configured entirely via `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` — no provider-specific code. Don't rely on `response_format: json_object` (support varies) and don't set `temperature` unless `LLM_TEMPERATURE` is explicit (some models reject arbitrary values). The prompt includes `EVENT_CONTEXT` so the model judges fit for the occasion, not just explicitness.

**No dotenv dependency** — `server.js` has its own minimal `.env` loader. Dependencies are just express, ws, qrcode; keep it that way unless there's a strong reason.

## Deployment

Runs on a home server via `docker compose up -d --build` — the image is built locally from source; there is no registry, no CI build. A self-hosted GitHub Actions runner (`.github/workflows/deploy.yml`) rebuilds on every push to `main`. The container joins the external `reverseproxy` Docker network; `PUBLIC_URL` in `.env` is what the QR code points to, and the reverse proxy must forward WebSocket upgrades. Do not add `pull_request` triggers to the deploy workflow — the repo is public and the runner is self-hosted.

Static assets are served with `Cache-Control: no-cache` on purpose (iOS Safari otherwise holds stale JS/CSS across deploys).
