// Guest (mobile) page: search YouTube, request a song, watch the live queue.

const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const toastEl = document.getElementById("toast");

// Remember the guest's name across requests (asked once).
let guestName = localStorage.getItem("guestName") || "";

// ---- Search -----------------------------------------------------------
document.getElementById("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = document.getElementById("q").value.trim();
  if (!q) return;
  document.getElementById("q").blur();
  resultsEl.innerHTML = "";
  setStatus("Searching…");
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(q));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");
    renderResults(data.results || []);
  } catch (err) {
    setStatus("😕 " + err.message);
  }
});

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
  if (!guestName) {
    const name = prompt("Your name (optional, shown on the queue):", "");
    guestName = (name || "").trim();
    localStorage.setItem("guestName", guestName);
  }
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const res = await fetch("/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...song, name: guestName }),
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

function toast(kind, emoji, text) {
  toastEl.className = `toast show ${kind}`;
  toastEl.innerHTML = `<span class="toast-emoji">${emoji}</span>${text}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.className = "toast"), 3800);
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
    li.querySelector(".s").textContent = item.channel + (item.addedBy ? ` · ${item.addedBy}` : "");
    ul.appendChild(li);
  });
}

connectWs();
