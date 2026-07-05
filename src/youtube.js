// YouTube access without an API key:
//  - searchYouTube(): scrapes the public results page and parses ytInitialData.
//  - checkPlayable(): uses the oEmbed endpoint to reject deleted/private videos
//    before they reach the queue. (Embed-disabled videos still return 200 here,
//    so the host player ALSO auto-skips on iframe error codes 101/150.)

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// The SOCS/CONSENT cookie avoids the EU "before you continue" consent wall that
// otherwise replaces ytInitialData with an interstitial.
const COMMON_HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: "SOCS=CAI;CONSENT=YES+1",
};

function pickThumbnail(thumbs) {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  // Prefer a medium-sized thumbnail; fall back to the last (largest).
  return (thumbs.find((t) => t.width >= 200) || thumbs[thumbs.length - 1]).url;
}

export async function searchYouTube(query, { limit = 12, timeoutMs = 8000 } = {}) {
  const url =
    "https://www.youtube.com/results?search_query=" +
    encodeURIComponent(query) +
    // sp=EgIQAQ%3D%3D filters results to videos only (no channels/playlists).
    "&sp=EgIQAQ%253D%253D";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let html;
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`YouTube responded ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const match =
    html.match(/ytInitialData\s*=\s*({.+?});<\/script>/s) ||
    html.match(/var ytInitialData = ({.+?});/s);
  if (!match) {
    throw new Error("Could not locate ytInitialData (YouTube layout changed or consent wall).");
  }

  const data = JSON.parse(match[1]);
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
      ?.contents || [];

  const results = [];
  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const v = item.videoRenderer;
      if (!v?.videoId) continue;
      const isLive = (v.badges || []).some(
        (b) => b?.metadataBadgeRenderer?.style === "BADGE_STYLE_TYPE_LIVE_NOW"
      ) || !v.lengthText;
      results.push({
        videoId: v.videoId,
        title: v.title?.runs?.map((r) => r.text).join("") || "(untitled)",
        channel:
          v.ownerText?.runs?.[0]?.text ||
          v.longBylineText?.runs?.[0]?.text ||
          "Unknown",
        duration: v.lengthText?.simpleText || (isLive ? "LIVE" : ""),
        thumbnail: pickThumbnail(v.thumbnail?.thumbnails),
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

// Returns { ok: true } if the video exists and is publicly available, or
// { ok: false, reason } for deleted/private/nonexistent IDs.
export async function checkPlayable(videoId, { timeoutMs = 5000 } = {}) {
  const url =
    "https://www.youtube.com/oembed?url=" +
    encodeURIComponent("https://youtu.be/" + videoId) +
    "&format=json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (res.status === 200) return { ok: true };
    if (res.status === 401) return { ok: false, reason: "This video has embedding disabled." };
    if (res.status === 404 || res.status === 400)
      return { ok: false, reason: "This video is private, deleted, or doesn't exist." };
    return { ok: false, reason: `This video can't be played (status ${res.status}).` };
  } catch (err) {
    // Network hiccup — don't block on it; let the host player be the backstop.
    return { ok: true, soft: true, note: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch richer metadata from the watch page for moderation context:
// category (Music vs not), YouTube's own isFamilySafe flag, and the description.
// Returns null on any failure — callers must treat it as best-effort.
export async function fetchVideoDetails(videoId, { timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://www.youtube.com/watch?v=" + videoId, {
      headers: COMMON_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:var|<\/script>)/s);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    const vd = data.videoDetails || {};
    const mf = data.microformat?.playerMicroformatRenderer || {};
    return {
      author: vd.author || "",
      category: mf.category || "",
      isFamilySafe: mf.isFamilySafe,
      description: (vd.shortDescription || "").slice(0, 500),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
