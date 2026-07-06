// LLM-based song moderation via any OpenAI-compatible chat API.
//
// Default provider is Kimi (Moonshot). Swap to DeepSeek / GLM / etc. by changing
// LLM_BASE_URL + LLM_MODEL + LLM_API_KEY in .env — no code changes.
//
// Design notes:
//  - We do NOT rely on `response_format: json_object` (support varies across
//    providers). Instead we instruct JSON in the prompt and defensively extract
//    the first {...} block from the reply.
//  - We do NOT set `temperature` (kimi-k2.x rejects arbitrary values); the API
//    default is used unless LLM_TEMPERATURE is set explicitly.
//  - FAIL-OPEN only for infrastructure failures (missing key, HTTP error,
//    timeout): a moderation outage never stops the party and never throws
//    into the request path.
//  - FAIL-CLOSED when the model answers but gives no verdict: provider
//    content_filter censorship or a reply without valid {"approved": ...}
//    JSON both mean the model dodged the question — reject the song.
//  - LLM_WEB_SEARCH=true (OpenRouter only) attaches OpenRouter's web plugin so
//    the model sees live search results — usually the song's actual lyrics —
//    instead of judging by title alone. Costs ~$0.005 per moderated request
//    (Exa search) on top of tokens; other providers reject the extra field,
//    hence opt-in.

function config(opts = {}) {
  return {
    apiKey: opts.apiKey ?? process.env.LLM_API_KEY ?? "",
    baseUrl: (opts.baseUrl ?? process.env.LLM_BASE_URL ?? "https://api.moonshot.ai/v1").replace(/\/+$/, ""),
    model: opts.model ?? process.env.LLM_MODEL ?? "kimi-k2.6",
    strict: opts.strict ?? (process.env.MODERATION_MODE || "").toLowerCase() === "strict",
    eventContext:
      opts.eventContext ??
      (process.env.EVENT_CONTEXT ||
        "a secondary school graduation dinner (prom-like party) in Hong Kong"),
    temperature: opts.temperature ?? process.env.LLM_TEMPERATURE, // undefined = use API default
    webSearch: opts.webSearch ?? (process.env.LLM_WEB_SEARCH || "").toLowerCase() === "true",
    timeoutMs: opts.timeoutMs, // resolved below — web search needs more headroom
  };
}

export function moderationConfigured() {
  return !!(process.env.LLM_API_KEY);
}

function buildMessages(song, details, { strict, eventContext, webSearch }) {
  const policy = strict
    ? "STRICT mode: approve ONLY clearly family-friendly music, regardless of the venue. Reject anything explicit, sexual, violent, hateful, politically sensitive, or borderline."
    : "Let the NATURE OF THIS EVENT set the bar — what fits a nightclub differs from a school dinner. " +
      "Reject only what a reasonable host of THIS event would veto: " +
      "clearly not music (podcast, gameplay, tutorial, talk, news, ASMR, sound effect), " +
      "or content genuinely inappropriate for this event's audience and setting — e.g. national anthems, " +
      "political/protest songs, or religious/ceremonial music at an ordinary social event; sexually explicit " +
      "tracks at a school or family event. " +
      "At adult venues (nightclubs, bars, adult parties), mainstream music with explicit lyrics or suggestive " +
      "themes IS acceptable — YouTube's isFamilySafe=false is NOT by itself a reason to reject. " +
      "When in doubt about an ordinary pop/party/love song, approve.";

  const ctx = [
    // The web plugin derives its search query from this message (there is no
    // explicit query field), so when search is on, lead with a lyrics-shaped
    // line to steer it at lyrics pages instead of reviews/video pages.
    // "歌詞" covers Chinese lyrics sites for Cantopop/Mandopop requests.
    webSearch ? `Find this song's lyrics: ${song.title} lyrics 歌詞` : null,
    `Title: ${song.title}`,
    `Channel: ${song.channel || details?.author || "unknown"}`,
    details?.category ? `YouTube category: ${details.category}` : null,
    details?.isFamilySafe !== undefined ? `YouTube isFamilySafe flag: ${details.isFamilySafe}` : null,
    details?.description ? `Description (truncated): ${details.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content:
        `You moderate song requests for the public music queue at ${eventContext}. ` +
        policy +
        (webSearch
          ? " Web search results about the song may be attached — use them to judge the ACTUAL" +
            " lyrical content and meaning, not just the title. A clean-sounding title with" +
            " inappropriate lyrics is a reject; ignore results that are about a different song."
          : "") +
        ' Respond ONLY with JSON of the form {"approved": boolean, "reason": string}. ' +
        "The reason is short, contains no URLs or citations, and is shown to the guest who requested the song.",
    },
    { role: "user", content: ctx },
  ];
}

// Pull the first balanced-ish {...} JSON object out of an LLM reply, tolerating
// markdown fences and surrounding prose.
function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

const APPROVED = { approved: true, reason: "Added!", moderated: false };

export async function moderate(song, details = null, opts = {}) {
  const c = config(opts);
  if (!c.apiKey) return APPROVED;

  const body = { model: c.model, messages: buildMessages(song, details, c) };
  if (c.temperature !== undefined) body.temperature = Number(c.temperature);
  // OpenRouter web plugin: searches the web for the song (the user message is
  // the query source) and injects the results — typically its lyrics page —
  // before the model answers. https://openrouter.ai/docs/guides/features/plugins/web-search
  if (c.webSearch) body.plugins = [{ id: "web", max_results: 5 }];

  // The search round-trip needs extra headroom before we give up and fail open.
  const timeoutMs = c.timeoutMs ?? (c.webSearch ? 20000 : 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(`[moderation] HTTP ${res.status} — failing open. ${t.slice(0, 200)}`);
      return APPROVED;
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const text = choice?.message?.content || "";
    // Web plugin citations — logged so the server logs show which pages
    // (ideally lyrics sites) each verdict was actually based on.
    const sources = (choice?.message?.annotations || [])
      .map((a) => a?.url_citation?.url)
      .filter(Boolean);
    if (sources.length) {
      console.log(`[moderation] "${song.title}" web sources: ${sources.slice(0, 5).join(" ")}`);
    }
    // If the provider's own safety layer censored the reply (finish_reason
    // "content_filter"), the topic itself is too sensitive for the model to
    // discuss — e.g. banned protest songs with Chinese-hosted models. That is
    // a REJECT, not a hiccup: fail closed here, unlike network errors.
    if (choice?.finish_reason === "content_filter") {
      console.warn(`[moderation] provider content_filter — rejecting. ${text.slice(0, 150)}`);
      return { approved: false, reason: "Not a good fit for this event.", moderated: true };
    }
    // No structured verdict (refusal prose, missing/invalid JSON): the model
    // dodged the question — reject. Only infrastructure failures fail open.
    const parsed = extractJson(text);
    if (!parsed || typeof parsed.approved !== "boolean") {
      console.warn(`[moderation] no structured verdict — rejecting. ${text.slice(0, 150)}`);
      return { approved: false, reason: "Not a good fit for this event.", moderated: true };
    }
    // The web plugin makes models append markdown citation links ("[youtube.com](https://…)");
    // the reason is shown raw to the guest, so drop them.
    const reason = String(parsed.reason || (parsed.approved ? "Added!" : "Not a good fit for the playlist."))
      .replace(/\s*\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\s*\b(?:see|source|sources)\s*[:.]?\s*$/i, "") // fragment left by a stripped trailing citation
      .trim();
    return {
      approved: parsed.approved,
      reason: reason || (parsed.approved ? "Added!" : "Not a good fit for the playlist."),
      moderated: true,
    };
  } catch (err) {
    console.warn(`[moderation] ${err?.name === "AbortError" ? "timeout" : "error"} — failing open. ${err?.message || ""}`);
    return APPROVED;
  } finally {
    clearTimeout(timer);
  }
}
