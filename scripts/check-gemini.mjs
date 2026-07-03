// Lists the Gemini models available to your API key, and does a quick
// moderation test. Run with: npm run check-gemini
//
// Reads GEMINI_API_KEY / GEMINI_MODEL from .env (same loader as the server).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { moderate } from "../src/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("No GEMINI_API_KEY in .env — moderation will auto-approve everything.");
  process.exit(1);
}

console.log("Fetching available models…\n");
const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + key);
if (!res.ok) {
  console.error("Failed to list models:", res.status, await res.text());
  process.exit(1);
}
const { models = [] } = await res.json();
const flash = models
  .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
  .map((m) => m.name.replace("models/", ""));
console.log("Models supporting generateContent:");
for (const name of flash) console.log("  -", name + (name.includes("flash") ? "  ⭐ (fast/cheap — good default)" : ""));

console.log(`\nUsing GEMINI_MODEL=${process.env.GEMINI_MODEL || "gemini-2.5-flash"}\n`);
console.log("Quick moderation test:");
for (const song of [
  { title: "Queen - Bohemian Rhapsody (Official Video)", channel: "Queen Official" },
  { title: "How to file your taxes 2024 — full tutorial", channel: "TaxTips" },
]) {
  const v = await moderate(song);
  console.log(`  ${v.approved ? "✅" : "🚫"}  ${song.title}  →  ${v.reason}`);
}
