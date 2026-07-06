// Guest (mobile) page: search YouTube, request a song, watch the live queue.

const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const toastsEl = document.getElementById("toasts");
const qEl = document.getElementById("q");
const nameEl = document.getElementById("name");
const sugSection = document.getElementById("suggestions-section");
const backToExploreBtn = document.getElementById("back-to-explore");

// ---- Explore (KTV-style browse) ----------------------------------------
// Genre tabs and singer chips run canned YouTube queries via /api/browse
// (cached server-side), so the songs shown are real and current — not a
// hardcoded list. "More songs" walks through the query variants.
// Query phrasing matters: "Official MV"-style queries surface real singles,
// while generic "熱門歌 2026" / "經典金曲" queries surface hour-long compilation
// videos (which the server's duration filter then rejects, leaving nothing) —
// always phrase queries in the "<artist/genre> Official MV / MV" style.
const THIS_YEAR = new Date().getFullYear();
const GENRE_QUERIES = {
  All: [`${THIS_YEAR} hit songs official MV`, `廣東歌 Official MV ${THIS_YEAR}`, `K-pop official MV ${THIS_YEAR}`, "party anthems official MV"],
  "K-pop": [`K-pop official MV ${THIS_YEAR}`, "K-pop dance official MV", "K-pop girl group official MV"],
  Cantopop: [`廣東歌 Official MV ${THIS_YEAR}`, "香港歌手 新歌 Official MV", "Cantopop official MV"],
  Mandopop: ["華語 新歌 Official MV", `華語流行 Official MV ${THIS_YEAR}`, "國語 經典 Official MV"],
  Western: ["top pop hits official MV", `pop official music video ${THIS_YEAR}`, "classic pop anthems official MV"],
  Party: ["party dance hits official MV", "EDM anthems official MV", "dancefloor classics official MV"],
  Classics: ["Beyond Official MV", "張國榮 MV", "陳慧嫻 MV", "廣東歌 90年代 Official MV"],
};
// Display: Chinese label + inline icon per genre (keys stay English — they
// index GENRE_QUERIES and the singer-filter slugs).
const GENRE_LABEL = { All: "全部", "K-pop": "K-pop", Cantopop: "廣東歌", Mandopop: "國語歌", Western: "歐美", Party: "派對", Classics: "經典" };
const GENRE_ICON = {
  All: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="7" r="2.6"/><circle cx="7" cy="17" r="2.6"/><circle cx="17" cy="17" r="2.6"/></svg>',
  "K-pop": '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.2-4.4-9.7-9.1A5 5 0 0112 5.6a5 5 0 019.7 5.3C19.2 15.6 12 20 12 20z"/></svg>',
  Cantopop: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9.3" y="2.8" width="5.4" height="10.5" rx="2.7"/><path d="M6.3 11a5.7 5.7 0 0011.4 0"/><path d="M12 16.7v3.3M9.3 20h5.4"/></svg>',
  Mandopop: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v9.6a3.4 3.4 0 101.6 2.9V8.6l5.9-1.4V4l-7.5 2z"/></svg>',
  Western: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.6 2.2 2.6 14.2 0 16.4c-2.6-2.2-2.6-14.2 0-16.4z"/></svg>',
  Party: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2 6.2h6.4l-5.2 3.9 2 6.4-5.2-4-5.2 4 2-6.4-5.2-3.9h6.4z"/></svg>',
  Classics: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>',
};
const GENRE_SLUG = { "K-pop": "kpop", Cantopop: "canto", Mandopop: "mando", Western: "western", Party: "party", Classics: "classics" };

const SINGERS = [
  { n: "陳奕迅", q: "陳奕迅 Eason Chan", g: "canto" },
  { n: "林家謙", q: "林家謙 Terence Lam", g: "canto" },
  { n: "姜濤", q: "姜濤 Keung To", g: "canto" },
  { n: "MC 張天賦", q: "MC 張天賦", g: "canto" },
  { n: "張敬軒", q: "張敬軒 Hins Cheung", g: "canto" },
  { n: "COLLAR", q: "COLLAR", g: "canto" },
  { n: "衛蘭", q: "衛蘭 Janice Vidal", g: "canto" },
  { n: "鄭欣宜", q: "鄭欣宜 Joyce Cheng", g: "canto" },
  { n: "Gin Lee", q: "Gin Lee 李幸倪", g: "canto" },
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
  { n: "Calvin Harris", q: "Calvin Harris", g: "party" },
  { n: "David Guetta", q: "David Guetta", g: "party" },
  { n: "Avicii", q: "Avicii", g: "party" },
  { n: "Black Eyed Peas", q: "Black Eyed Peas", g: "party" },
  { n: "Beyond", q: "Beyond", g: "classics" },
  { n: "張國榮", q: "張國榮 Leslie Cheung", g: "classics" },
  { n: "陳慧嫻", q: "陳慧嫻 Priscilla Chan", g: "classics" },
  { n: "譚詠麟", q: "譚詠麟 Alan Tam", g: "classics" },
];

const moreBtn = document.getElementById("more");
let activeGenre = "All"; // which tab is selected — also filters the singer row
let activeKey = "genre:All"; // "genre:<name>" or "singer:<name>" (highlight)
const browse = { queries: [], idx: 0, seen: new Set(), gen: 0 };

// Fisher-Yates — used both for the query-variant reorder (shuffle button) and
// to shuffle fetched results client-side, since the server cache returns the
// same array every time for a given query.
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderGenreTabs() {
  const bar = document.getElementById("genre-tabs");
  bar.innerHTML = "";
  for (const g of Object.keys(GENRE_QUERIES)) {
    const btn = document.createElement("button");
    btn.className = "genre-tab" + (activeKey === `genre:${g}` ? " active" : "");
    btn.innerHTML = `${GENRE_ICON[g]}<span></span>`;
    btn.querySelector("span").textContent = GENRE_LABEL[g];
    btn.onclick = () => selectGenre(g);
    bar.appendChild(btn);
  }
}

function renderSingers() {
  const row = document.getElementById("singers");
  row.innerHTML = "";
  const list =
    activeGenre === "All" ? SINGERS : SINGERS.filter((s) => s.g === GENRE_SLUG[activeGenre]);
  for (const s of list) {
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
  activeGenre = g;
  activeKey = `genre:${g}`;
  renderGenreTabs();
  renderSingers();
  startBrowse(GENRE_QUERIES[g]);
}

function selectSinger(s) {
  activeKey = `singer:${s.n}`;
  renderGenreTabs();
  renderSingers();
  startBrowse([`${s.q} official MV`, `${s.q} music video`, `${s.q} MV`]);
}

async function startBrowse(queries) {
  browse.queries = queries;
  browse.idx = 0;
  browse.seen = new Set();
  browse.gen++; // invalidate any in-flight loadMoreSongs from the previous tab/search
  resultsEl.innerHTML = "";
  moreBtn.classList.add("hidden");
  await loadMoreSongs();
}

// Walks through query variants (one /api/browse call per variant) until it
// finds at least one song not already shown, or runs out of variants — so a
// variant whose results are all dupes doesn't silently add nothing (D3).
async function loadMoreSongs() {
  const gen = browse.gen;
  moreBtn.disabled = true;
  setStatus("載入歌曲中… Loading songs…");
  try {
    while (browse.idx < browse.queries.length) {
      const q = browse.queries[browse.idx++];
      const res = await fetch("/api/browse?q=" + encodeURIComponent(q));
      if (browse.gen !== gen) return; // stale — a newer tab/search/shuffle took over
      const data = await res.json();
      if (browse.gen !== gen) return;
      if (!res.ok) throw new Error(data.error || "Couldn't load songs.");
      let fresh = (data.results || []).filter((r) => r.videoId && !browse.seen.has(r.videoId));
      if (fresh.length === 0) continue; // this variant was all dupes — try the next one
      for (const r of fresh) browse.seen.add(r.videoId);
      fresh = shuffleArray(fresh); // don't show the same order every time (A4)
      setStatus("");
      appendResults(fresh);
      break;
    }
    if (browse.gen === gen && browse.seen.size === 0) {
      setStatus("沒有找到歌曲 — 試試其他分類。No songs found — try another tab.");
    }
  } catch (err) {
    if (browse.gen === gen) setStatus("😕 " + err.message);
  } finally {
    if (browse.gen === gen) {
      moreBtn.disabled = false;
      moreBtn.classList.toggle("hidden", browse.idx >= browse.queries.length);
    }
  }
}

moreBtn.onclick = loadMoreSongs;

document.getElementById("shuffle").onclick = () => {
  // Re-run the current selection with its query variants in a fresh order.
  startBrowse(shuffleArray(browse.queries));
};

// ---- Search -----------------------------------------------------------
document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  doSearch(qEl.value.trim());
});

async function doSearch(q) {
  if (!q) return backToExplore(); // empty submit restores explore

  qEl.blur();
  resultsEl.innerHTML = "";
  sugSection.classList.add("hidden"); // hide explore once searching
  moreBtn.classList.add("hidden");
  backToExploreBtn.classList.remove("hidden");
  setStatus("搜尋中… Searching…");
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(q));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");
    renderResults(data.results || []);
  } catch (err) {
    setStatus("😕 " + err.message);
  }
}

// Restore the explore section after a search — re-runs whatever browse
// selection (genre/singer) was active before the guest searched.
function backToExplore() {
  qEl.value = "";
  resultsEl.innerHTML = "";
  setStatus("");
  backToExploreBtn.classList.add("hidden");
  sugSection.classList.remove("hidden");
  startBrowse(browse.queries);
}

backToExploreBtn.onclick = backToExplore;

function setStatus(text) {
  if (!text) return statusEl.classList.add("hidden");
  statusEl.textContent = text;
  statusEl.classList.remove("hidden");
}

// Placeholder for missing thumbnails — a bare <img src=""> would otherwise
// request the current page URL. Same pattern as host.js's queue rendering.
const NO_THUMB = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';

function resultCard(r) {
  const li = document.createElement("li");
  li.innerHTML = `
    <img src="${r.thumbnail || NO_THUMB}" alt="" loading="lazy" />
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
  if (results.length === 0) return setStatus("沒有結果，試試其他關鍵字。No results — try a different search.");
  setStatus("");
  resultsEl.innerHTML = "";
  appendResults(results);
}

// ---- Guest identity -----------------------------------------------------
// Persistent random id sent with requests so the server's cooldown is
// per-phone, not per-IP (guests on the venue Wi-Fi share one public IP).
const clientId =
  localStorage.getItem("clientId") ||
  (() => {
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
    localStorage.setItem("clientId", id);
    return id;
  })();

// ---- Guest name (persisted, optional) ----------------------------------
nameEl.value = localStorage.getItem("guestName") || "";
nameEl.addEventListener("change", () => {
  localStorage.setItem("guestName", nameEl.value.trim());
});

// ---- Own requests (for the "YOU" badge in the queue) -------------------
function loadMyRequestIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem("myRequestIds") || "[]"));
  } catch {
    return new Set();
  }
}
function rememberMyRequest(id) {
  const ids = [...loadMyRequestIds(), id].slice(-50); // cap so it can't grow unbounded
  localStorage.setItem("myRequestIds", JSON.stringify(ids));
}

// ---- Request a song ---------------------------------------------------
async function requestSong(song, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  // Persistent, animated "checking" card — with the web-searching filter a
  // verdict can take 5–20s, so it must read as activity, not a frozen toast.
  const t = toast("info", "🔎", "檢查歌曲中…", { persist: true, sub: "Checking song…", checking: true });
  try {
    const res = await fetch("/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...song, name: nameEl.value.trim(), clientId }),
    });
    const data = await res.json();
    if (data.ok) {
      const main = data.position === 0 ? "已加入 · 現正播放" : `已加入 · 排第 ${data.position} 首`;
      const sub = data.position === 0 ? "Added — playing now!" : `Added — #${data.position} in the queue!`;
      t.set("ok", "✓", main, { sub });
      btn.textContent = "✓";
      if (data.id) {
        rememberMyRequest(data.id);
        // The queue broadcast usually lands before this response does, so the
        // row was rendered without knowing it's ours — re-render for the badge.
        if (lastQueueState) renderQueue(lastQueueState);
      }
    } else {
      if (data.retryIn) {
        t.dismiss();
        cooldownToast(data.retryIn);
      } else t.set("bad", "🚫", data.reason || "Couldn't add that song.");
      btn.disabled = false;
      btn.textContent = "+";
    }
  } catch (err) {
    t.set("bad", "⚠️", "網絡錯誤，請再試。", { sub: "Network error. Try again." });
    btn.disabled = false;
    btn.textContent = "+";
  }
}

// Stacking toasts: each card is its own element (icon circle + Chinese main
// line + smaller English subline). toast() returns a handle whose set() morphs
// the card in place — a request's "checking…" card becomes its own verdict —
// so parallel requests never clobber each other's feedback.
const MAX_TOASTS = 3;

function toast(kind, icon, main, opts = {}) {
  const el = document.createElement("div");
  el.className = "toast";
  toastsEl.appendChild(el);
  while (toastsEl.children.length > MAX_TOASTS) toastsEl.firstElementChild.remove();
  void el.offsetHeight; // flush styles so adding .show below animates the entry
  let timer;
  const h = {
    el,
    set(kind2, icon2, main2, { persist = false, sub = "", checking = false } = {}) {
      el.className = `toast show ${kind2}${checking ? " checking" : ""}`;
      el.innerHTML = `
        <span class="toast-ico"></span>
        <div><div class="toast-main"></div><div class="toast-sub"></div></div>`;
      el.querySelector(".toast-ico").textContent = icon2;
      el.querySelector(".toast-main").textContent = main2;
      const subEl = el.querySelector(".toast-sub");
      if (sub) subEl.textContent = sub;
      else subEl.remove();
      clearTimeout(timer);
      if (!persist) timer = setTimeout(h.dismiss, 3800);
    },
    dismiss() {
      clearTimeout(timer);
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300); // let the exit transition play
    },
  };
  h.set(kind, icon, main, opts);
  return h;
}

// Live countdown shown when the server rejects a request for coming too soon
// (retryIn = seconds left). Singleton card: retrying mid-cooldown restarts the
// countdown on the same card instead of stacking duplicates.
function cooldownToast(seconds) {
  clearInterval(cooldownToast._i);
  if (!cooldownToast._h?.el.isConnected) {
    cooldownToast._h = toast("bad", "⏳", "", { persist: true });
  }
  const t = cooldownToast._h;
  let left = seconds;
  const draw = () =>
    t.set("bad", "⏳", `再等 ${left} 秒`, { persist: true, sub: `Next song in ${left}s…` });
  draw();
  cooldownToast._i = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(cooldownToast._i);
      t.dismiss();
    } else draw();
  }, 1000);
}

// ---- Live queue (WebSocket) ------------------------------------------
let lastQueueState = null; // kept so the 你 badge can re-render after an add

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "state") {
      lastQueueState = msg.state;
      renderQueue(msg.state);
    }
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
}

function renderQueue(state) {
  const np = state.nowPlaying;
  const npEl = document.getElementById("now-playing");
  if (np) {
    npEl.classList.remove("hidden");
    npEl.innerHTML = `
      <img src="${np.thumbnail || NO_THUMB}" alt="" />
      <div class="np-body">
        <div class="np-label">
          <span class="eq"><span></span><span></span><span></span></span>
          現正播放 NOW PLAYING
        </div>
        <div class="np-title"></div>
        <div class="np-sub"></div>
      </div>`;
    npEl.querySelector(".np-title").textContent = np.title;
    npEl.querySelector(".np-sub").textContent = np.channel || "";
  } else {
    npEl.classList.add("hidden");
  }

  const queue = state.queue || [];
  document.getElementById("queue-count").textContent = queue.length;
  const ul = document.getElementById("queue");
  ul.innerHTML = "";
  if (queue.length === 0) {
    ul.innerHTML = '<li class="q-empty">暫時未有歌曲 — 快啲點歌啦！Nothing queued yet — be the first!</li>';
    return;
  }
  const myIds = loadMyRequestIds();
  queue.forEach((item, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="q-num">${i + 1}</span>
      <img src="${item.thumbnail || NO_THUMB}" alt="" loading="lazy" />
      <div class="q-text"><div class="t-row"><span class="t"></span></div><div class="s"></div></div>`;
    li.querySelector(".t").textContent = item.title;
    li.querySelector(".s").textContent = item.channel;
    if (myIds.has(item.id)) {
      const chip = document.createElement("span");
      chip.className = "q-you";
      chip.textContent = "你";
      li.querySelector(".t-row").appendChild(chip);
    }
    ul.appendChild(li);
  });
}

renderSingers();
selectGenre("All"); // renders tabs + loads real songs on open
connectWs();
