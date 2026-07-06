// Host (projector) page: drives the YouTube player from the server's queue and
// reports playback events back so the server can advance the queue.

let player = null;
let playerReady = false;
let started = false;
let currentVideoId = null;
let latestState = { nowPlaying: null, queue: [] };
let filterOn = false;
let moderationConfigured = false;
let cooldownSeconds = 15;
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
      if (typeof msg.cooldownSeconds === "number") cooldownSeconds = msg.cooldownSeconds;
      render();
      renderFilter();
      renderCooldown();
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
  document.getElementById("now-label").classList.toggle("hidden", !np);
  document.getElementById("now-title").textContent = np ? np.title : "—";
  document.getElementById("now-channel").textContent = np
    ? np.channel + (np.addedBy ? ` · 點唱: ${np.addedBy}` : "")
    : "";

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
    li.querySelector(".q-sub").textContent = item.addedBy ? `點唱: ${item.addedBy}` : item.channel;
    li.querySelector(".q-remove").onclick = () => send({ type: "remove", id: item.id });
    ul.appendChild(li);
  }
}

const SHIELD_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-3z"/><path d="M9 12l2 2 4-4.5"/></svg>';
const CLOCK_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12.5" r="8"/><path d="M12 8.5v4.5l3 2"/><path d="M9.5 2.5h5"/></svg>';

function renderFilter() {
  const btn = document.getElementById("filter-toggle");
  btn.innerHTML = `${SHIELD_SVG}<span>過濾：${filterOn ? "開" : "關"}</span>`;
  btn.classList.toggle("on", filterOn);
  // Warn if the filter is on but no LLM key is configured (it'll accept all).
  document.getElementById("filter-hint").classList.toggle("hidden", !(filterOn && !moderationConfigured));
}

function renderCooldown() {
  const btn = document.getElementById("cooldown-toggle");
  btn.innerHTML = `${CLOCK_SVG}<span>冷卻：${cooldownSeconds ? cooldownSeconds + "s" : "關"}</span>`;
  btn.classList.toggle("on", cooldownSeconds > 0);
}

const PAUSE_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/></svg>';
const PLAY_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

function updatePlayPauseIcon() {
  if (!playerReady) return;
  const playing = player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING;
  document.getElementById("playpause").innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
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
  // Cycle through preset cooldowns; the server echoes the value back via state.
  const COOLDOWN_STEPS = [0, 5, 10, 15, 30, 60];
  document.getElementById("cooldown-toggle").onclick = () => {
    const i = COOLDOWN_STEPS.indexOf(cooldownSeconds);
    send({ type: "setCooldown", seconds: COOLDOWN_STEPS[(i + 1) % COOLDOWN_STEPS.length] });
  };
  const volEl = document.getElementById("volume");
  const paintVol = () => volEl.style.setProperty("--vol", `${volEl.value}%`);
  paintVol();
  volEl.oninput = () => {
    paintVol();
    if (playerReady) player.setVolume(parseInt(volEl.value, 10));
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
