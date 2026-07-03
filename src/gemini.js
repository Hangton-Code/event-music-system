// Gemini-based song moderation. Judges a song from its title + channel only.
//
// IMPORTANT (honest limitation): title+channel catches obvious non-music and
// explicit *titles*, but cannot detect explicit audio hiding under a clean
// title. This is a coarse filter, not full content moderation.
//
// Failure mode is FAIL-OPEN: if the key is missing or Gemini errors/times out,
// the song is approved so a moderation hiccup never stops the party. Every such
// case is logged.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function buildPrompt({ title, channel }, strict) {
  const policy = strict
    ? "Approve ONLY clearly family-friendly, event-appropriate music. Reject anything explicit, suggestive, violent, or borderline."
    : "Reject only if it is clearly NOT music (podcast, gameplay, tutorial, talk, news, ASMR, sound effect) OR if the title signals explicit/offensive/NSFW content. Otherwise approve.";

  return (
    "You are moderating song requests for a live event's public music queue.\n" +
    policy +
    "\nJudge using the title and channel below.\n\n" +
    `Title: ${title}\nChannel: ${channel}\n\n` +
    'Respond as JSON: {"approved": boolean, "reason": string}. ' +
    "Keep reason short and guest-facing (it is shown to the person who requested the song)."
  );
}

export async function moderate(song, opts = {}) {
  const {
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
    strict = (process.env.MODERATION_MODE || "").toLowerCase() === "strict",
    timeoutMs = 7000,
  } = opts;

  if (!apiKey) {
    return { approved: true, reason: "Added!", moderated: false };
  }

  const url = `${ENDPOINT}/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: buildPrompt(song, strict) }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[gemini] HTTP ${res.status} — failing open. ${detail.slice(0, 200)}`);
      return { approved: true, reason: "Added!", moderated: false };
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = JSON.parse(text);
    return {
      approved: !!parsed.approved,
      reason: String(parsed.reason || (parsed.approved ? "Added!" : "Not a good fit for the playlist.")),
      moderated: true,
    };
  } catch (err) {
    console.warn(`[gemini] ${err?.name === "AbortError" ? "timeout" : "error"} — failing open. ${err?.message || ""}`);
    return { approved: true, reason: "Added!", moderated: false };
  } finally {
    clearTimeout(timer);
  }
}
