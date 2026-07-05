// Host (projector) page: drives the YouTube player from the server's queue and
// reports playback events back so the server can advance the queue.

let player = null;
let playerReady = false;
let started = false;
let currentVideoId = null;
let latestState = { nowPlaying: null, queue: [] };
let filterOn = false;
let moderationConfigured = false;
let ws = null;

// ---- WebSocket --------------------------------------------------------
function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "state") {
      latestState = msg.state;
      if (typeof msg.filterOn === "boolean") filterOn = msg.filterOn;
      render();
      renderFilter();
      syncPlayer();
    }
  };
  ws.onclose = () => setTimeout(connectWs, 1500); // auto-reconnect
}
function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// ---- YouTube IFrame API ----------------------------------------------
window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player("player", {
    height: "100%",
    width: "100%",
    playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: () => {
        playerReady = true;
        syncPlayer();
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) {
          send({ type: "ended", videoId: currentVideoId });
        }
        updatePlayPauseIcon();
      },
      onError: (e) => {
        // 101/150 = embedding disabled by owner; 100 = removed; 2 = bad id.
        console.warn("Player error", e.data, "on", currentVideoId);
        send({ type: "error", videoId: currentVideoId, code: e.data });
      },
    },
  });
};

// Make the player match whatever the server says is now playing.
function syncPlayer() {
  if (!started || !playerReady) return;
  const np = latestState.nowPlaying;
  const idle = document.getElementById("idle");

  if (!np) {
    currentVideoId = null;
    if (player.stopVideo) player.stopVideo();
    idle.classList.remove("hidden");
    return;
  }
  idle.classList.add("hidden");
  if (np.videoId !== currentVideoId) {
    currentVideoId = np.videoId;
    player.loadVideoById(np.videoId);
    player.playVideo();
  }
}

// ---- Rendering --------------------------------------------------------
function render() {
  const np = latestState.nowPlaying;
  document.getElementById("now-title").textContent = np ? np.title : "—";
  document.getElementById("now-channel").textContent = np ? np.channel : "";

  const queue = latestState.queue || [];
  document.getElementById("queue-count").textContent = queue.length;
  const ul = document.getElementById("queue");
  ul.innerHTML = "";
  if (queue.length === 0) {
    ul.innerHTML = '<li class="q-empty">Queue is empty — scan the QR to add a song.</li>';
    return;
  }
  for (const item of queue) {
    const li = document.createElement("li");
    const thumb = item.thumbnail
      ? `<img src="${item.thumbnail}" alt="" />`
      : '<img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E" alt="" />';
    li.innerHTML = `
      ${thumb}
      <div class="q-meta">
        <div class="q-title"></div>
        <div class="q-sub"></div>
      </div>
      <button class="q-remove" title="Remove">✕</button>`;
    li.querySelector(".q-title").textContent = item.title;
    li.querySelector(".q-sub").textContent =
      item.channel + (item.addedBy ? ` · ${item.addedBy}` : "");
    li.querySelector(".q-remove").onclick = () => send({ type: "remove", id: item.id });
    ul.appendChild(li);
  }
}

function renderFilter() {
  const btn = document.getElementById("filter-toggle");
  btn.textContent = `🛡 Filter: ${filterOn ? "ON" : "OFF"}`;
  btn.classList.toggle("on", filterOn);
  // Warn if the filter is on but no LLM key is configured (it'll accept all).
  document.getElementById("filter-hint").classList.toggle("hidden", !(filterOn && !moderationConfigured));
}

function updatePlayPauseIcon() {
  if (!playerReady) return;
  const playing = player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING;
  document.getElementById("playpause").textContent = playing ? "⏸" : "▶";
}

// ---- Controls ---------------------------------------------------------
function wireControls() {
  document.getElementById("playpause").onclick = () => {
    if (!playerReady) return;
    const s = player.getPlayerState();
    if (s === YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  };
  document.getElementById("skip").onclick = () => send({ type: "skip" });
  document.getElementById("filter-toggle").onclick = () => send({ type: "setFilter", on: !filterOn });
  document.getElementById("volume").oninput = (e) => {
    if (playerReady) player.setVolume(parseInt(e.target.value, 10));
  };
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); document.getElementById("playpause").click(); }
    if (e.key.toLowerCase() === "n") document.getElementById("skip").click();
  });
}

// ---- Bootstrap --------------------------------------------------------
async function loadInfo() {
  try {
    const info = await (await fetch("/api/info")).json();
    document.getElementById("qr").src = info.qr;
    document.getElementById("guest-url").textContent = info.guestUrl.replace(/^https?:\/\//, "");
    filterOn = !!info.filterOn;
    moderationConfigured = !!info.moderationConfigured;
    renderFilter();
  } catch (err) {
    document.getElementById("guest-url").textContent = "Could not load guest link";
  }
}

document.getElementById("start-btn").onclick = () => {
  started = true;
  document.getElementById("start-overlay").classList.add("hidden");
  document.getElementById("stage").classList.remove("hidden");
  syncPlayer();
};

loadInfo();
wireControls();
connectWs();
