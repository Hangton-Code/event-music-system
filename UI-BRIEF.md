# Event Music System — UI brief

A **QR jukebox** for a live event (a secondary-school graduation dinner in Hong Kong).
A projector shows the **Host page**; guests scan the on-screen QR code, open the
**Guest page** on their phones, and queue YouTube songs. There are only these two
screens. Current implementation is plain HTML/CSS/JS (`public/host.*` and
`public/guest.*`) — a redesign can restyle everything, but the element ids and
behaviors below must keep working.

---

## 1. Host page (`/`) — the projected screen

Viewed from across a dark venue, on a projector. Big, legible, glanceable.

**Start overlay** — full-screen card with logo, title, and a single **▶ Start**
button (one click is required by browsers to unlock audio). Small note about
routing audio to the venue AV system.

**Player pane** (main area)
- Embedded YouTube player (16:9), fills most of the screen.
- Idle state when the queue is empty: 🎧 emoji + "Scan the QR code to add the first one!"
- Below the video: **now-playing title** and a secondary line with
  **channel · 點唱: guest-name** (the requester credit, only when the guest gave a name).
- Control row:
  - ⏸/▶ play-pause (also keyboard `space`)
  - ⏭ skip (also keyboard `n`)
  - 🛡 **Filter pill** — toggles the LLM content filter ON/OFF live; has an
    "on" (highlighted) state and a small warning hint ("no LLM key — accepts all")
    when it's ON but unconfigured.
  - ⏱ **Cooldown pill** — shows the per-guest request cooldown ("Cooldown: 15s"
    or "Cooldown: OFF"); clicking cycles presets 0 / 5 / 10 / 15 / 30 / 60 s.
  - 🔊 volume slider.

**Sidebar**
- **QR card** — "Scan to add a song", large QR code, the guest URL in plain text
  under it. This is the single most important element for guests far from the screen.
- **Up Next card** — live queue list with count badge. Each row: thumbnail,
  title, channel · requester name, and an ✕ remove button (host-only control).
  Empty state: "Queue is empty — scan the QR to add a song."

Everything updates live over WebSocket — no refresh, no loading states beyond the above.

---

## 2. Guest page (`/guest`) — mobile phones

Mobile-only in practice. Guests use it for ~30 seconds at a time, often in the
dark, possibly tipsy. Big tap targets. Content mixes Chinese and English
(song titles, singer names like 陳奕迅 / BLACKPINK).

**Header** — title + one-line explainer.

**Name field** — optional single input, "shown with your song"; persisted on the
phone, so returning guests see it pre-filled.

**Search bar** — text input + Search button, hits YouTube directly.

**Explore section (the "KTV" browser)** — the default view and the heart of the page:
- **Singer chips row** — horizontally scrollable chips, each with a circular
  avatar (first character of the name, genre-colored) + name. Tapping loads that
  singer's songs. The row is filtered by the active genre tab.
- **Genre tabs** — 🔥 All · 💜 K-pop · 🎤 Cantopop · 🎵 Mandopop · 🎧 Western ·
  🪩 Party · 📼 Classics. One is always active (highlighted).
- **🔀 Shuffle button** — reshuffles the current selection's songs.
- Songs shown are real, current YouTube results (fetched live), not a hardcoded list.

**Results list** (shared by explore and search) — rows of: thumbnail, title,
channel · duration, and a round **+ add button**. Button states: `+` → `…`
(checking) → `✓` (added, disabled). A **"More songs ↓"** button appends the next
batch. After a search, a **"← Back to Explore"** button restores the explore view.

**Status line** — inline messages: "Loading songs…", "Searching…",
"No songs found — try another tab.", error strings with 😕.

**Toast** (bottom, floating) — the request feedback channel:
- 🔎 "Checking song…" (persistent while the server verifies)
- ✅ "Added — playing now!" / "Added — #3 in the queue!"
- 🚫 rejection with a reason (e.g. "That song is already in the queue!",
  "Not a good fit for this event.", "Queue is full…")
- ⏳ **live countdown** when the guest is rate-limited: "Next song in 12s…"
  ticking down each second.

**Up Next section** — live queue (count badge, now-playing banner with "NOW
PLAYING" label, numbered list of title + channel). Rows for songs this guest
requested carry a small **"YOU" badge**. Empty state: "Nothing queued yet — be
the first!"

---

## Flows to keep in mind

1. **Happy path**: scan QR → land on explore → tap a genre/singer → tap + →
   toast confirms with queue position → song appears in Up Next (with YOU badge).
2. **Search path**: type → results → add → "← Back to Explore".
3. **Rejections**: duplicate song, queue full (50), content filter, unplayable
   video, and the ⏳ cooldown countdown. Each is a toast with a human reason —
   the guest should never feel stuck.
4. **Host moderating live**: toggling the filter, changing the cooldown,
   removing/skipping songs — all reflected on every phone within a second.

## Constraints

- No framework, no build step: deliverables should map to plain CSS (two
  stylesheets) and the existing DOM structure/ids where possible.
- Guest page: small screens, one-handed use, `no-cache` assets (design can change
  freely between events). Host page: 16:9 projector, dark room, readable from meters away.
- The YouTube player look itself can't be restyled (it's an embedded iframe).
- Text content is bilingual by nature; fonts must cover Traditional Chinese.
