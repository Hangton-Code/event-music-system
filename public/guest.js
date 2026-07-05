// Guest (mobile) page: search YouTube, request a song, watch the live queue.

const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const toastEl = document.getElementById("toast");
const qEl = document.getElementById("q");
const sugSection = document.getElementById("suggestions-section");

// ---- Suggestions (curated hits across genres) -------------------------
const SUGGESTIONS = [
  { a: "NewJeans", t: "Super Shy", g: "K-pop" },
  { a: "BTS", t: "Dynamite", g: "K-pop" },
  { a: "BLACKPINK", t: "How You Like That", g: "K-pop" },
  { a: "IVE", t: "I AM", g: "K-pop" },
  { a: "aespa", t: "Spicy", g: "K-pop" },
  { a: "LE SSERAFIM", t: "ANTIFRAGILE", g: "K-pop" },
  { a: "(G)I-DLE", t: "TOMBOY", g: "K-pop" },
  { a: "陳奕迅 Eason Chan", t: "富士山下", g: "Cantopop" },
  { a: "Beyond", t: "海闊天空", g: "Cantopop" },
  { a: "MIRROR", t: "boss", g: "Cantopop" },
  { a: "張國榮 Leslie Cheung", t: "Monica", g: "Cantopop" },
  { a: "Twins", t: "下一站天后", g: "Cantopop" },
  { a: "林家謙", t: "一人之境", g: "Cantopop" },
  { a: "MC 張天賦", t: "反對無效", g: "Cantopop" },
  { a: "周杰倫 Jay Chou", t: "稻香", g: "Mandopop" },
  { a: "五月天 Mayday", t: "突然好想你", g: "Mandopop" },
  { a: "鄧紫棋 G.E.M.", t: "光年之外", g: "Mandopop" },
  { a: "林俊傑 JJ Lin", t: "江南", g: "Mandopop" },
  { a: "The Weeknd", t: "Blinding Lights", g: "Western" },
  { a: "Dua Lipa", t: "Levitating", g: "Western" },
  { a: "Ed Sheeran", t: "Shape of You", g: "Western" },
  { a: "Bruno Mars", t: "Uptown Funk", g: "Western" },
  { a: "Taylor Swift", t: "Shake It Off", g: "Western" },
  { a: "Coldplay", t: "Viva la Vida", g: "Western" },
  { a: "Avicii", t: "Wake Me Up", g: "Party" },
  { a: "Black Eyed Peas", t: "I Gotta Feeling", g: "Party" },
  { a: "Calvin Harris", t: "Feel So Close", g: "Party" },
  { a: "David Guetta", t: "Titanium", g: "Party" },
];

function renderSuggestions() {
  const picks = [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 8);
  const box = document.getElementById("suggestions");
  box.innerHTML = "";
  for (const s of picks) {
    const btn = document.createElement("button");
    btn.className = "sug-chip";
    btn.innerHTML = `<span class="sug-genre"></span><span class="sug-name"></span>`;
    btn.querySelector(".sug-genre").textContent = s.g;
    btn.querySelector(".sug-name").textContent = `${s.a} – ${s.t}`;
    btn.onclick = () => {
      qEl.value = `${s.a} ${s.t}`;
      doSearch(qEl.value);
    };
    box.appendChild(btn);
  }
}

document.getElementById("shuffle").onclick = renderSuggestions;

// ---- Search -----------------------------------------------------------
document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  doSearch(qEl.value.trim());
});

async function doSearch(q) {
  if (!q) return;
  qEl.blur();
  resultsEl.innerHTML = "";
  sugSection.classList.add("hidden"); // hide suggestions once searching
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

function renderResults(results) {
  if (results.length === 0) return setStatus("No results. Try a different search.");
  setStatus("");
  resultsEl.innerHTML = "";
  for (const r of results) {
    const li = document.createElement("li");
    li.innerHTML = `
      <img src="${r.thumbnail || ""}" alt="" />
      <div class="r-meta">
        <div class="r-title"></div>
        <div class="r-sub"></div>
      </div>
      <button class="add-btn" title="Add">+</button>`;
    li.querySelector(".r-title").textContent = r.title;
    li.querySelector(".r-sub").textContent = r.channel + (r.duration ? ` · ${r.duration}` : "");
    const btn = li.querySelector(".add-btn");
    btn.onclick = () => requestSong(r, btn);
    resultsEl.appendChild(li);
  }
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

renderSuggestions();
connectWs();
