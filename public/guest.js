// Guest (mobile) page: search YouTube, request a song, watch the live queue.

const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const toastEl = document.getElementById("toast");
const qEl = document.getElementById("q");
const sugSection = document.getElementById("suggestions-section");

// ---- Explore (KTV-style browse) ----------------------------------------
// Genre tabs and singer chips run canned YouTube queries via /api/browse
// (cached server-side), so the songs shown are real and current — not a
// hardcoded list. "More songs" walks through the query variants.
const GENRE_QUERIES = {
  All: ["2026 hit songs official MV", "廣東歌 熱門 MV", "K-pop hits MV", "party anthems official MV"],
  "K-pop": ["K-pop hits 2026 MV", "K-pop dance hits official MV", "K-pop girl group hits MV"],
  Cantopop: ["廣東歌 2026 熱門 MV", "廣東歌 經典金曲 MV", "香港流行曲 熱門 MV"],
  Mandopop: ["華語流行 金曲 MV", "華語 2026 新歌 MV", "國語經典歌曲 MV"],
  Western: ["top pop hits official MV", "billboard hits 2026", "classic pop anthems MV"],
  Party: ["party dance hits official MV", "EDM party anthems MV", "dancefloor classics MV"],
};
const GENRE_EMOJI = { All: "🔥", "K-pop": "💜", Cantopop: "🎤", Mandopop: "🎵", Western: "🎧", Party: "🪩" };

const SINGERS = [
  { n: "陳奕迅", q: "陳奕迅 Eason Chan", g: "canto" },
  { n: "林家謙", q: "林家謙 Terence Lam", g: "canto" },
  { n: "姜濤", q: "姜濤 Keung To", g: "canto" },
  { n: "MC 張天賦", q: "MC 張天賦", g: "canto" },
  { n: "張敬軒", q: "張敬軒 Hins Cheung", g: "canto" },
  { n: "周杰倫", q: "周杰倫 Jay Chou", g: "mando" },
  { n: "G.E.M.", q: "鄧紫棋 G.E.M.", g: "mando" },
  { n: "林俊傑", q: "林俊傑 JJ Lin", g: "mando" },
  { n: "五月天", q: "五月天 Mayday", g: "mando" },
  { n: "NewJeans", q: "NewJeans", g: "kpop" },
  { n: "BTS", q: "BTS", g: "kpop" },
  { n: "BLACKPINK", q: "BLACKPINK", g: "kpop" },
  { n: "aespa", q: "aespa", g: "kpop" },
  { n: "Taylor Swift", q: "Taylor Swift", g: "western" },
  { n: "Bruno Mars", q: "Bruno Mars", g: "western" },
  { n: "Ed Sheeran", q: "Ed Sheeran", g: "western" },
  { n: "The Weeknd", q: "The Weeknd", g: "western" },
];

const moreBtn = document.getElementById("more");
let activeKey = "genre:All"; // "genre:<name>" or "singer:<name>"
const browse = { queries: [], idx: 0, seen: new Set() };

function renderGenreTabs() {
  const bar = document.getElementById("genre-tabs");
  bar.innerHTML = "";
  for (const g of Object.keys(GENRE_QUERIES)) {
    const btn = document.createElement("button");
    btn.className = "genre-tab" + (activeKey === `genre:${g}` ? " active" : "");
    btn.textContent = `${GENRE_EMOJI[g]} ${g}`;
    btn.onclick = () => selectGenre(g);
    bar.appendChild(btn);
  }
}

function renderSingers() {
  const row = document.getElementById("singers");
  row.innerHTML = "";
  for (const s of SINGERS) {
    const btn = document.createElement("button");
    btn.className = `singer-chip${activeKey === `singer:${s.n}` ? " active" : ""}`;
    btn.innerHTML = `<span class="singer-avatar g-${s.g}"></span><span class="singer-name"></span>`;
    btn.querySelector(".singer-avatar").textContent = [...s.n][0];
    btn.querySelector(".singer-name").textContent = s.n;
    btn.onclick = () => selectSinger(s);
    row.appendChild(btn);
  }
}

function selectGenre(g) {
  activeKey = `genre:${g}`;
  renderGenreTabs();
  renderSingers();
  startBrowse(GENRE_QUERIES[g]);
}

function selectSinger(s) {
  activeKey = `singer:${s.n}`;
  renderGenreTabs();
  renderSingers();
  startBrowse([`${s.q} official MV`, `${s.q} 熱門歌曲 MV`, `${s.q} greatest hits`]);
}

async function startBrowse(queries) {
  browse.queries = queries;
  browse.idx = 0;
  browse.seen = new Set();
  resultsEl.innerHTML = "";
  moreBtn.classList.add("hidden");
  await loadMoreSongs();
}

async function loadMoreSongs() {
  if (browse.idx >= browse.queries.length) return moreBtn.classList.add("hidden");
  const q = browse.queries[browse.idx++];
  moreBtn.disabled = true;
  setStatus("Loading songs…");
  try {
    const res = await fetch("/api/browse?q=" + encodeURIComponent(q));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't load songs.");
    const fresh = (data.results || []).filter((r) => r.videoId && !browse.seen.has(r.videoId));
    for (const r of fresh) browse.seen.add(r.videoId);
    setStatus(browse.seen.size === 0 ? "No songs found — try another tab." : "");
    appendResults(fresh);
  } catch (err) {
    setStatus("😕 " + err.message);
  } finally {
    moreBtn.disabled = false;
    moreBtn.classList.toggle("hidden", browse.idx >= browse.queries.length);
  }
}

moreBtn.onclick = loadMoreSongs;

document.getElementById("shuffle").onclick = () => {
  // Re-run the current selection with its query variants in a fresh order.
  startBrowse([...browse.queries].sort(() => Math.random() - 0.5));
};

// ---- Search -----------------------------------------------------------
document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  doSearch(qEl.value.trim());
});

async function doSearch(q) {
  if (!q) return;
  qEl.blur();
  resultsEl.innerHTML = "";
  sugSection.classList.add("hidden"); // hide explore once searching
  moreBtn.classList.add("hidden");
  setStatus("Searching…");
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(q));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");
    renderResults(data.results || []);
  } catch (err) {
    setStatus("😕 " + err.message);
  }
}

function setStatus(text) {
  if (!text) return statusEl.classList.add("hidden");
  statusEl.textContent = text;
  statusEl.classList.remove("hidden");
}

function resultCard(r) {
  const li = document.createElement("li");
  li.innerHTML = `
    <img src="${r.thumbnail || ""}" alt="" loading="lazy" />
    <div class="r-meta">
      <div class="r-title"></div>
      <div class="r-sub"></div>
    </div>
    <button class="add-btn" title="Add">+</button>`;
  li.querySelector(".r-title").textContent = r.title;
  li.querySelector(".r-sub").textContent = r.channel + (r.duration ? ` · ${r.duration}` : "");
  const btn = li.querySelector(".add-btn");
  btn.onclick = () => requestSong(r, btn);
  return li;
}

function appendResults(results) {
  for (const r of results) resultsEl.appendChild(resultCard(r));
}

function renderResults(results) {
  if (results.length === 0) return setStatus("No results. Try a different search.");
  setStatus("");
  resultsEl.innerHTML = "";
  appendResults(results);
}

// ---- Request a song ---------------------------------------------------
async function requestSong(song, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  toast("info", "🔎", "Checking song…", true); // persistent until we get a verdict
  try {
    const res = await fetch("/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(song),
    });
    const data = await res.json();
    if (data.ok) {
      const where = data.position === 0 ? "playing now" : `#${data.position} in the queue`;
      toast("ok", "✅", `Added — ${where}!`);
      btn.textContent = "✓";
    } else {
      toast("bad", "🚫", data.reason || "Couldn't add that song.");
      btn.disabled = false;
      btn.textContent = "+";
    }
  } catch (err) {
    toast("bad", "⚠️", "Network error. Try again.");
    btn.disabled = false;
    btn.textContent = "+";
  }
}

function toast(kind, emoji, text, persist = false) {
  toastEl.className = `toast show ${kind}`;
  toastEl.innerHTML = `<span class="toast-emoji">${emoji}</span>${text}`;
  clearTimeout(toast._t);
  if (!persist) toast._t = setTimeout(() => (toastEl.className = "toast"), 3800);
}

// ---- Live queue (WebSocket) ------------------------------------------
function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "state") renderQueue(msg.state);
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
}

function renderQueue(state) {
  const np = state.nowPlaying;
  const npEl = document.getElementById("now-playing");
  if (np) {
    npEl.classList.remove("hidden");
    npEl.innerHTML = `<div class="np-label">NOW PLAYING</div><div class="np-title"></div>`;
    npEl.querySelector(".np-title").textContent = np.title;
  } else {
    npEl.classList.add("hidden");
  }

  const queue = state.queue || [];
  document.getElementById("queue-count").textContent = queue.length;
  const ul = document.getElementById("queue");
  ul.innerHTML = "";
  if (queue.length === 0) {
    ul.innerHTML = '<li class="q-empty">Nothing queued yet — be the first!</li>';
    return;
  }
  queue.forEach((item, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="q-num">${i + 1}</span>
      <div class="q-text"><div class="t"></div><div class="s"></div></div>`;
    li.querySelector(".t").textContent = item.title;
    li.querySelector(".s").textContent = item.channel;
    ul.appendChild(li);
  });
}

renderSingers();
selectGenre("All"); // renders tabs + loads real songs on open
connectWs();
