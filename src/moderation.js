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
//    network error): a moderation outage never stops the party and never
//    throws into the request path.
//  - FAIL-CLOSED on timeout, with a retryable reason shown to the guest:
//    slow verdicts cluster on exactly the songs the filter exists for, so a
//    timed-out song must not play unmoderated.
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
  // The prompt is assembled in DECISION ORDER: hard rejects first (rule 1 —
  // nothing after it may override it), then the mode's bar, then situational
  // rules, then output format. National anthems are spelled out in rule 1
  // because models otherwise reason "patriotic = family-friendly = approve";
  // the Beyond carve-out is deliberate host policy — a classic that merely
  // acquired political associations is not a political song. 'Stay' appears
  // as a calibration example in both branches with opposite verdicts on
  // purpose: only one branch is ever sent, and it marks exactly where the
  // strict/default bar sits.
  const rules = [
    `You moderate song requests for the public music queue at ${eventContext}. ` +
      "Decide in this order: rule 1 first, then the bar in rule 2, then the remaining rules. " +
      "Rule 1 is absolute — nothing in the later rules, the video's metadata, or the song's " +
      "popularity can override it.",

    "RULE 1 — HARD REJECTS (every mode, every event, no exceptions): " +
      "(a) not music: podcasts, gameplay, tutorials, talks, news, ASMR, sound effects. " +
      "(b) ANY country's national anthem — sung, instrumental, or an official rendition. An anthem " +
      "is a state-ceremonial piece, never party music, no matter how clean its lyrics are or how " +
      "family-safe its YouTube flags look. " +
      "(c) songs whose core purpose is political: protest songs, political messaging, propaganda. " +
      "Clarification: a mainstream pop/rock classic that merely ACQUIRED political associations " +
      "over the years (e.g. Beyond's 海闊天空 or 光輝歲月, both graduation staples) is NOT a " +
      "political song — judge what the song itself is about, not what it has been used for. " +
      "(d) songs built on hatred: hate speech, slurs, degrading a group. " +
      "(e) lyrics loaded with heavy profanity.",

    strict
      ? "RULE 2 — STRICT MODE BAR: approve ONLY clearly family-friendly music, regardless of the " +
        "venue. NO profanity at all — even a few casual swear words in the lyrics are a reject " +
        "(e.g. 'Stay' by The Kid LAROI & Justin Bieber is a REJECT in strict mode). Also reject " +
        "sexual, violent, or otherwise adult content. Ordinary clean pop, love songs, and dance " +
        "tracks are approvals — strictness is about content, not genre. When genuinely unsure " +
        "whether a song is family-friendly, reject."
      : "RULE 2 — EVENT BAR: let the nature of this event set the bar — what fits a nightclub " +
        "differs from a school dinner. Reject what a reasonable host of THIS event would veto " +
        "(e.g. sexually explicit tracks at a school or family event). A LITTLE casual profanity in " +
        "an otherwise benign mainstream song is fine (e.g. 'Stay' by The Kid LAROI & Justin Bieber " +
        "is an APPROVE here). At adult venues (nightclubs, bars, adult parties), mainstream music " +
        "with explicit lyrics or suggestive themes IS acceptable — YouTube's isFamilySafe=false is " +
        "NOT by itself a reason to reject. When in doubt about an ordinary pop/party/love song, " +
        "approve.",

    "RULE 3 — RELIGIOUS MUSIC: hymns, praise & worship, and ceremonial religious pieces do not " +
      "fit a party queue — reject them, unless the event described above is itself a religious " +
      "occasion.",

    "RULE 4 — CLEAN EDITS: if the title marks the video as a clean/censored edit ('clean', " +
      "'clean version', 'radio edit'), judge THAT edit, not the original — profanity and slurs " +
      "are bleeped out of it. Approve clean edits of mainstream songs even in strict mode; reject " +
      "one only when the song remains unmistakably unfit because its core subject is still graphic " +
      "sex or violence. A clean edit never rescues a rule-1 song.",

    // Host's rule: a song whose lyrics can't be checked doesn't play. This
    // deliberately overrides rule 2's approve-when-in-doubt lean.
    webSearch
      ? "RULE 5 — WEB SEARCH RESULTS about the song may be attached. Use them to judge the ACTUAL " +
        "lyrical content and meaning, not just the title; ignore results that are about a different " +
        "song. A clean-sounding title with inappropriate lyrics is a reject (unless it is a clean " +
        "edit, rule 4). If you cannot determine the song's actual lyrical content at all — the " +
        "search results don't contain its lyrics AND you don't reliably know the song yourself — " +
        "REJECT it: unverifiable lyrics are not allowed to play, even if the title looks harmless. " +
        "This overrides rule 2's when-in-doubt lean. Purely instrumental tracks are exempt from " +
        "lyric verification (but not from rule 1)."
      : null,

    'OUTPUT: respond ONLY with JSON of the form {"approved": boolean, "reason": string}. The ' +
      "reason is shown to the guest who requested the song: write it in Traditional Chinese " +
      "(繁體中文，香港用語), keep it short and friendly, and include no URLs or citations.",
  ];

  const policy = rules.filter(Boolean).join("\n\n");

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
    { role: "system", content: policy },
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

  // The search round-trip needs extra headroom: the model typically answers in
  // 6-14s with search on, but sensitive songs can deliberate well past that.
  const timeoutMs = c.timeoutMs ?? (c.webSearch ? 35000 : 8000);
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
      return { approved: false, reason: "這首歌不太適合這個場合。", moderated: true };
    }
    // No structured verdict (refusal prose, missing/invalid JSON): the model
    // dodged the question — reject. Only infrastructure failures fail open.
    const parsed = extractJson(text);
    if (!parsed || typeof parsed.approved !== "boolean") {
      console.warn(`[moderation] no structured verdict — rejecting. ${text.slice(0, 150)}`);
      return { approved: false, reason: "這首歌不太適合這個場合。", moderated: true };
    }
    // The web plugin makes models append markdown citation links ("[youtube.com](https://…)");
    // the reason is shown raw to the guest, so drop them.
    const reason = String(parsed.reason || (parsed.approved ? "Added!" : "這首歌不太適合這個場合。"))
      .replace(/\s*\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\s*\b(?:see|source|sources)\s*[:.]?\s*$/i, "") // fragment left by a stripped trailing citation
      .trim();
    return {
      approved: parsed.approved,
      reason: reason || (parsed.approved ? "Added!" : "這首歌不太適合這個場合。"),
      moderated: true,
    };
  } catch (err) {
    // Timeout is fail-CLOSED with a retryable message: slow verdicts cluster on
    // exactly the songs the filter exists for (a banned protest song once slipped
    // through this way), so a timed-out song must not play unmoderated. The guest
    // can simply tap again; if the provider is truly down the host can toggle the
    // filter off live. Network errors below still fail open.
    if (err?.name === "AbortError") {
      console.warn(`[moderation] timeout after ${timeoutMs}ms — rejecting (guest may retry).`);
      return { approved: false, reason: "系統繁忙，請再試一次。", moderated: false };
    }
    console.warn(`[moderation] error — failing open. ${err?.message || ""}`);
    return APPROVED;
  } finally {
    clearTimeout(timer);
  }
}
