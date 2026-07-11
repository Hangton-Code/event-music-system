// Load test: simulates N phone guests against a running deployment.
//
//   bun scripts/loadtest.mjs --url https://your-public-url --guests 140
//
// Each virtual guest behaves like a real one: loads /guest, holds a WebSocket
// open (reconnecting if dropped, like guest.js does), taps browse tabs,
// occasionally searches, occasionally requests a song. Prints latency
// percentiles and error counts at the end.
//
// Knobs (defaults are event-realistic for ~140 people):
//   --url URL             target (default http://localhost:45416)
//   --guests N            concurrent guests (default 140)
//   --duration SECS       hold time after ramp-up (default 120)
//   --ramp SECS           connect stagger window (default 20)
//   --browse-per-min N    total browse taps/min across all guests (default 60; cached server-side)
//   --search-per-min N    total live searches/min (default 6 — each one hits YouTube, keep low)
//   --request-per-min N   total song requests/min (default 20 — hits YouTube oEmbed + LLM if filter is ON)
//
// Before running against production: turn the filter OFF from the host page
// (or accept ~request-per-min LLM calls), and restart the container afterwards
// to clear the junk queue.

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--([a-z-]+)$/);
  if (m) args[m[1]] = process.argv[++i];
}

const BASE = (args.url || "http://localhost:45416").replace(/\/+$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");
const GUESTS = parseInt(args.guests || "140", 10);
const DURATION_MS = parseInt(args.duration || "120", 10) * 1000;
const RAMP_MS = parseInt(args.ramp || "20", 10) * 1000;
const BROWSE_PER_MIN = parseFloat(args["browse-per-min"] || "60");
const SEARCH_PER_MIN = parseFloat(args["search-per-min"] || "6");
const REQUEST_PER_MIN = parseFloat(args["request-per-min"] || "20");

// The guest page's canned tab/chip queries — these are cache-friendly.
const BROWSE_QUERIES = [
  "__hk_hits",
  "廣東歌 2024",
  "廣東歌 90年代",
  "英文流行曲",
  "K-pop hits",
  "畢業歌",
];
const SEARCH_QUERIES = [
  "周杰倫", "陳奕生 富士山下", "Taylor Swift", "MIRROR", "張學友",
  "aespa", "Ed Sheeran", "五月天", "林家謙", "IU",
];

// --- metrics ---------------------------------------------------------------
const lat = { page: [], wsFirstState: [], browse: [], search: [], request: [] };
const counts = {
  wsConnected: 0, wsDropped: 0, wsReconnects: 0, wsFailed: 0,
  broadcasts: 0,
  browseOk: 0, browseErr: 0,
  searchOk: 0, searchErr: 0,
  requestAccepted: 0, requestRejected: 0, requestErr: 0,
};
const errors = new Map(); // message -> count
function noteErr(msg) {
  errors.set(msg, (errors.get(msg) || 0) + 1);
}
function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function fmt(arr) {
  if (!arr.length) return "  (no samples)";
  return `  n=${arr.length}  p50=${pct(arr, 50)}ms  p95=${pct(arr, 95)}ms  max=${Math.max(...arr)}ms`;
}

// --- harvest real videoIds so /api/request exercises the real pipeline ------
async function harvestVideoIds() {
  const ids = [];
  for (const q of BROWSE_QUERIES.slice(0, 4)) {
    try {
      const r = await fetch(`${BASE}/api/browse?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      for (const item of j.results || []) ids.push(item);
    } catch {
      /* server will be exercised anyway; requests just get skipped */
    }
  }
  return ids;
}

// --- one virtual guest -------------------------------------------------------
let stopping = false;
const sockets = new Set();

async function timedFetch(bucket, okCounter, errCounter, url, opts) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, opts);
    const j = await r.json();
    lat[bucket].push(Date.now() - t0);
    if (r.ok) counts[okCounter]++;
    else {
      counts[errCounter]++;
      noteErr(`${bucket} HTTP ${r.status}`);
    }
    return j;
  } catch (err) {
    lat[bucket].push(Date.now() - t0);
    counts[errCounter]++;
    noteErr(`${bucket}: ${err.message}`);
    return null;
  }
}

function connectWs(guest) {
  const t0 = Date.now();
  let gotFirstState = false;
  try {
    const ws = new WebSocket(`${WS_BASE}/`);
    sockets.add(ws);
    ws.onopen = () => {
      counts.wsConnected++;
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "state") {
          counts.broadcasts++;
          if (!gotFirstState) {
            gotFirstState = true;
            lat.wsFirstState.push(Date.now() - t0);
          }
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      sockets.delete(ws);
      if (!stopping) {
        counts.wsDropped++;
        counts.wsReconnects++;
        setTimeout(() => connectWs(guest), 1000 + Math.random() * 2000);
      }
    };
    ws.onerror = () => { /* onclose fires after */ };
  } catch (err) {
    counts.wsFailed++;
    noteErr(`ws connect: ${err.message}`);
  }
}

function poisson(perMinutePerGuest) {
  // ms until this guest's next action, exponentially distributed
  if (perMinutePerGuest <= 0) return Infinity;
  return -Math.log(1 - Math.random()) * (60000 / perMinutePerGuest);
}

async function runGuest(i, videoPool) {
  const clientId = `loadtest-${i}-${Math.random().toString(36).slice(2, 10)}`;

  // 1. page load
  const t0 = Date.now();
  try {
    await fetch(`${BASE}/guest`);
    lat.page.push(Date.now() - t0);
  } catch (err) {
    lat.page.push(Date.now() - t0);
    noteErr(`page: ${err.message}`);
  }

  // 2. persistent WebSocket
  connectWs(i);

  // 3. behavior loops — per-guest rates so totals hit the configured target
  const loops = [
    [BROWSE_PER_MIN / GUESTS, async () => {
      const q = BROWSE_QUERIES[Math.floor(Math.random() * BROWSE_QUERIES.length)];
      await timedFetch("browse", "browseOk", "browseErr", `${BASE}/api/browse?q=${encodeURIComponent(q)}`);
    }],
    [SEARCH_PER_MIN / GUESTS, async () => {
      const q = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
      await timedFetch("search", "searchOk", "searchErr", `${BASE}/api/search?q=${encodeURIComponent(q)}`);
    }],
    [REQUEST_PER_MIN / GUESTS, async () => {
      if (!videoPool.length) return;
      const v = videoPool[Math.floor(Math.random() * videoPool.length)];
      const j = await timedFetch("request", "requestAccepted", "requestErr", `${BASE}/api/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, name: `LoadTester ${i}`, clientId }),
      });
      // ok:false (cooldown / duplicate / queue full / filter) is expected traffic,
      // not an error — reclassify.
      if (j && j.ok === false) {
        counts.requestAccepted--;
        counts.requestRejected++;
      }
    }],
  ];

  for (const [rate, action] of loops) {
    (async () => {
      while (!stopping) {
        const wait = poisson(rate);
        if (wait === Infinity) return;
        await new Promise((r) => setTimeout(r, wait));
        if (stopping) return;
        await action();
      }
    })();
  }
}

// --- main --------------------------------------------------------------------
console.log(`Target: ${BASE}`);
console.log(`Guests: ${GUESTS}, ramp ${RAMP_MS / 1000}s, hold ${DURATION_MS / 1000}s`);
console.log(`Rates/min (total): browse=${BROWSE_PER_MIN} search=${SEARCH_PER_MIN} request=${REQUEST_PER_MIN}\n`);

const videoPool = await harvestVideoIds();
console.log(`Harvested ${videoPool.length} real videoIds for request traffic.`);
if (!videoPool.length) console.log("(!) No videoIds harvested — /api/request won't be exercised.");

for (let i = 0; i < GUESTS; i++) {
  setTimeout(() => runGuest(i, videoPool), Math.random() * RAMP_MS);
}

const total = RAMP_MS + DURATION_MS;
const startedAt = Date.now();
const ticker = setInterval(() => {
  const el = Math.round((Date.now() - startedAt) / 1000);
  process.stdout.write(
    `\r[${el}s] ws=${sockets.size} broadcasts=${counts.broadcasts} ` +
    `browse=${counts.browseOk}/${counts.browseErr}err search=${counts.searchOk}/${counts.searchErr}err ` +
    `req=${counts.requestAccepted}ok/${counts.requestRejected}rej/${counts.requestErr}err   `
  );
}, 2000);

await new Promise((r) => setTimeout(r, total));
stopping = true;
clearInterval(ticker);
for (const ws of sockets) try { ws.close(); } catch { /* ignore */ }

console.log("\n\n=== RESULTS ===============================================");
console.log(`WebSocket   connected=${counts.wsConnected} dropped=${counts.wsDropped} reconnects=${counts.wsReconnects} failed=${counts.wsFailed}`);
console.log(`Broadcasts  received=${counts.broadcasts} (across all guests)`);
console.log(`\nLatency:`);
console.log(`  /guest page      ${fmt(lat.page)}`);
console.log(`  WS -> 1st state  ${fmt(lat.wsFirstState)}`);
console.log(`  /api/browse      ${fmt(lat.browse)}`);
console.log(`  /api/search      ${fmt(lat.search)}`);
console.log(`  /api/request     ${fmt(lat.request)}`);
console.log(`\nRequests: accepted=${counts.requestAccepted} rejected(cooldown/dup/full/filter)=${counts.requestRejected} errors=${counts.requestErr}`);
if (errors.size) {
  console.log(`\nErrors:`);
  for (const [msg, n] of errors) console.log(`  ${n}x  ${msg}`);
} else {
  console.log(`\nNo errors. 🎉`);
}
process.exit(0);
