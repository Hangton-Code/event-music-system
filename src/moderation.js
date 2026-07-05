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
//  - FAIL-OPEN: missing key, HTTP error, timeout, or unparseable reply all
//    resolve to { approved: true }. A moderation hiccup never stops the party
//    and never throws into the request path.

function config(opts = {}) {
  return {
    apiKey: opts.apiKey ?? process.env.LLM_API_KEY ?? "",
    baseUrl: (opts.baseUrl ?? process.env.LLM_BASE_URL ?? "https://api.moonshot.ai/v1").replace(/\/+$/, ""),
    model: opts.model ?? process.env.LLM_MODEL ?? "kimi-k2.6",
    strict: opts.strict ?? (process.env.MODERATION_MODE || "").toLowerCase() === "strict",
    temperature: opts.temperature ?? process.env.LLM_TEMPERATURE, // undefined = use API default
    timeoutMs: opts.timeoutMs ?? 8000,
  };
}

export function moderationConfigured() {
  return !!(process.env.LLM_API_KEY);
}

function buildMessages(song, details, strict) {
  const policy = strict
    ? "Approve ONLY clearly family-friendly, event-appropriate music. Reject anything explicit, sexual, violent, hateful, or borderline."
    : "Reject only if it is clearly NOT music (podcast, gameplay, tutorial, talk, news, ASMR, sound effect) OR if it contains explicit/offensive/NSFW content. Otherwise approve.";

  const ctx = [
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
        "You moderate song requests for a live event's public music queue. " +
        policy +
        ' Respond ONLY with JSON of the form {"approved": boolean, "reason": string}. ' +
        "The reason is short and shown to the guest who requested the song.",
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

  const body = { model: c.model, messages: buildMessages(song, details, c.strict) };
  if (c.temperature !== undefined) body.temperature = Number(c.temperature);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.timeoutMs);
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
    const text = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(text);
    if (!parsed || typeof parsed.approved !== "boolean") {
      console.warn(`[moderation] unparseable reply — failing open. ${text.slice(0, 150)}`);
      return APPROVED;
    }
    return {
      approved: parsed.approved,
      reason: String(parsed.reason || (parsed.approved ? "Added!" : "Not a good fit for the playlist.")),
      moderated: true,
    };
  } catch (err) {
    console.warn(`[moderation] ${err?.name === "AbortError" ? "timeout" : "error"} — failing open. ${err?.message || ""}`);
    return APPROVED;
  } finally {
    clearTimeout(timer);
  }
}
