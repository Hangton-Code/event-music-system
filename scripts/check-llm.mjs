// Verifies your LLM moderation provider (Kimi by default) and runs a quick
// moderation test. Run with: bun run check-llm
//
// Reads LLM_API_KEY / LLM_BASE_URL / LLM_MODEL from .env.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { moderate } from "../src/moderation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const key = process.env.LLM_API_KEY;
const baseUrl = (process.env.LLM_BASE_URL || "https://api.moonshot.ai/v1").replace(/\/+$/, "");
const model = process.env.LLM_MODEL || "kimi-k2.6";

if (!key) {
  console.error("No LLM_API_KEY in .env — moderation will accept everything even when the filter is ON.");
  process.exit(1);
}

console.log(`Provider base URL: ${baseUrl}`);
console.log(`Model:             ${model}\n`);

// Most OpenAI-compatible providers expose GET /v1/models.
try {
  const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.ok) {
    const { data = [] } = await res.json();
    console.log("Available models:");
    for (const m of data) console.log("  -", m.id);
    console.log();
  } else {
    console.log(`(GET /models returned ${res.status} — provider may not support listing; continuing.)\n`);
  }
} catch (e) {
  console.log(`(Could not list models: ${e.message}; continuing.)\n`);
}

console.log("Moderation test (title + channel only):");
for (const song of [
  { title: "BTS (방탄소년단) 'Dynamite' Official MV", channel: "HYBE LABELS" },
  { title: "How to file your taxes 2024 — full tutorial", channel: "TaxTips" },
  { title: "God Save the King — British National Anthem", channel: "Royal Anthems" },
]) {
  const v = await moderate(song);
  console.log(`  ${v.approved ? "✅" : "🚫"}  ${song.title}  →  ${v.reason}`);
}
