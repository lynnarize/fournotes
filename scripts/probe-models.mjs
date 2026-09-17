#!/usr/bin/env node
// Finds the free OpenRouter models that actually work with Four Notes, and
// locks Settings to them by rewriting src/lib/ai/verified-models.json.
//
// Each candidate is tested through the app's own code (dev server required):
//   chat     "remind me… / I spent 45k…" must create a to-do AND a 45,000 transaction,
//            with no tool-call planning leaking into the reply
//   capture  a meeting transcript must become a note via the forced capture tool
//   vision   (photo-capable models only) a receipt must become a 128,500 transaction
//   brief    the daily brief must be 3 emoji lines, not the model's reasoning;
//            the fastest model that passes becomes the "fast" model
//
// Usage (dev server running: npm run dev):
//   read -s OPENROUTER_API_KEY && export OPENROUTER_API_KEY   # paste key, press Enter
//   npm run probe:models                       # test every free model that claims tool support
//   npm run probe:models -- --only a:free,b:free
//   npm run probe:models -- --limit 6 --dry    # don't write the file
//
// Free accounts get about 50 requests a day; each model uses 3-5. Use --limit
// or --only if you've already used some of today's allowance.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const OUT = fileURLToPath(new URL("src/lib/ai/verified-models.json", root));
const IMAGE = readFileSync(new URL("scripts/probe-receipt.jpg", root)).toString("base64");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = value("base") ?? "http://localhost:3000";
const ONLY = value("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const LIMIT = Number(value("limit") ?? Infinity);
const DRY = flag("dry");
const GAP_MS = Number(process.env.PROBE_GAP_MS ?? 3500); // stay under ~20 requests/minute

const KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!KEY) {
  console.error("Set OPENROUTER_API_KEY first:  read -s OPENROUTER_API_KEY && export OPENROUTER_API_KEY");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOOL_WORDS = /\b(create_todo|add_transaction|create_note|file_capture|dueAt|remindAt|tool_calls?|function call)\b/i;

async function probe(model, test) {
  const res = await fetch(`${BASE}/api/ai/probe`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-openrouter-key": KEY },
    body: JSON.stringify({ model, test, image: test === "vision" ? IMAGE : undefined }),
    signal: AbortSignal.timeout(120_000),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ ok: false, error: `dev server unreachable at ${BASE}: ${e.message}` }) }));
  if (res.status === 404) throw new Error("The probe endpoint is disabled. Run it against `npm run dev`, not a production build.");
  return res.json();
}

const checks = {
  chat(r) {
    const todo = r.actions?.find((a) => a.type === "create_todo" && /umbrella/i.test(a.title ?? ""));
    const tx = r.actions?.find((a) => a.type === "add_transaction" && Math.abs(Number(a.amount) - 45000) < 1);
    if (!todo) return "no umbrella to-do";
    if (!tx) return "no 45,000 transaction";
    if (TOOL_WORDS.test(r.reply ?? "")) return "planning text leaked into the reply";
    return null;
  },
  capture(r) {
    const note = r.actions?.find((a) => a.type === "create_note");
    if (!note || /Scanned item/.test(note.title ?? "")) return "didn't use the capture tool";
    return null;
  },
  brief(r) {
    const lines = (r.reply ?? "").split("\n").filter((l) => l.trim());
    if (lines.length !== 3 || !lines.every((l) => /^\p{Extended_Pictographic}/u.test(l.trim()))) return "brief isn't 3 emoji lines";
    return null;
  },
  vision(r) {
    const tx = r.actions?.find((a) => a.type === "add_transaction");
    if (!tx) return "receipt not recognised";
    if (Math.abs(Number(tx.amount) - 128500) > 1) return `wrong total (${tx.amount})`;
    return null;
  },
};

// 1) Candidates: free models that advertise tools + tool_choice.
const catalog = (await (await fetch("https://openrouter.ai/api/v1/models")).json()).data;
const byId = new Map(catalog.map((m) => [m.id, m]));
let candidates = catalog.filter((m) => {
  const p = m.supported_parameters ?? [];
  return m.id.endsWith(":free") && p.includes("tools") && p.includes("tool_choice");
});
if (ONLY) {
  const missing = ONLY.filter((id) => !byId.has(id));
  if (missing.length) console.warn(`Not on OpenRouter (skipped): ${missing.join(", ")}`);
  candidates = ONLY.filter((id) => byId.has(id)).map((id) => byId.get(id));
}
candidates = candidates.slice(0, LIMIT);
if (!candidates.length) { console.error("No candidate models found."); process.exit(1); }

const seesImages = (m) => (m.architecture?.input_modalities ?? []).includes("image");
console.log(`Testing ${candidates.length} model(s) against ${BASE}\n`);

// 2) Probe each one. A model is dropped at its first failure to save requests.
const results = [];
let rateLimited = false;
const busy = [];
for (const m of candidates) {
  // brief first: it only decides the fast model, so a failure there isn't fatal.
  const tests = ["brief", "chat", "capture", ...(seesImages(m) ? ["vision"] : [])];
  const OPTIONAL = new Set(["brief", "vision"]);
  const row = { id: m.id, name: m.name, vision: false, brief: false, briefMs: 0, pass: true, flaky: false, ms: 0, notes: [] };
  let unavailable = false;
  for (const test of tests) {
    let r = await probe(m.id, test);
    await sleep(GAP_MS);
    // Free models are inconsistent: give a wrong chat answer one more try, but remember it.
    if (test === "chat" && r.ok && checks.chat(r)) {
      const first = checks.chat(r);
      r = await probe(m.id, test);
      await sleep(GAP_MS);
      if (r.ok && !checks.chat(r)) { row.flaky = true; row.notes.push(`chat: passed on retry (first try: ${first})`); }
    }
    if (r.status === 429) { rateLimited = true; break; }
    // The model's free pool is full upstream: no verdict, keep it as it is and move on.
    if (r.status === 503) { unavailable = true; break; }
    if (r.status === 401) {
      console.error(`OpenRouter rejected the key: ${r.error}\nCheck OPENROUTER_API_KEY and try again. Nothing was written.`);
      process.exit(1);
    }
    if (!r.ok) {
      row.notes.push(`${test}: ${r.error}`);
      if (!OPTIONAL.has(test)) { row.pass = false; break; }
      continue;
    }
    const problem = checks[test](r);
    if (problem) {
      row.notes.push(`${test}: ${problem}`);
      if (!OPTIONAL.has(test)) { row.pass = false; break; }
      continue;
    }
    if (test === "brief") { row.brief = true; row.briefMs = r.ms; continue; }
    row.ms += r.ms;
    if (test === "vision") row.vision = true;
  }
  if (rateLimited) {
    // Not the model's fault: don't record a verdict for it.
    console.error(`\nRate limited while testing ${m.id}. Stopping here; re-run later with --only for the untested models.`);
    break;
  }
  if (unavailable) {
    busy.push(m.id);
    console.log(`${"BUSY (skipped)".padEnd(24)} ${m.id}  — provider busy upstream; left unchanged, re-test later`);
    continue;
  }
  results.push(row);
  const extras = [row.vision && "photos", row.brief && "brief", row.flaky && "inconsistent"].filter(Boolean).join(", ");
  const mark = row.pass ? `PASS${extras ? ` (${extras})` : ""}` : row.brief ? "FAIL (brief ok)" : "FAIL";
  console.log(`${mark.padEnd(24)} ${m.id}${row.notes.length ? `  — ${row.notes.join("; ")}` : ""}`);
}

// 3) Lock the list: consistent before inconsistent, then photo-capable, then fastest.
if (busy.length) console.log(`\nBusy, not tested: ${busy.join(", ")}\nRe-run later: npm run probe:models -- --only ${busy.join(",")}`);
const passed = results.filter((r) => r.pass).sort((a, b) => Number(a.flaky) - Number(b.flaky) || Number(b.vision) - Number(a.vision) || a.ms - b.ms);
console.log(`\n${passed.length} of ${results.length} passed.`);
if (!passed.length && !ONLY) { console.log("Nothing to lock; verified-models.json left unchanged."); process.exit(1); }

const current = JSON.parse(readFileSync(OUT, "utf8"));
const label = (r) => (r.name ?? r.id).replace(/^[^:]+:\s*/, "").replace(/\s*\(free\)\s*$/i, "").trim();
// Models this run didn't test keep their place (so --only never drops the rest),
// unless OpenRouter has withdrawn them.
const tested = new Set(results.map((r) => r.id));
const untouched = current.models.filter((m) => !tested.has(m.id) && byId.has(m.id));
const dropped = current.models.filter((m) => !tested.has(m.id) && !byId.has(m.id)).map((m) => m.id);
if (dropped.length) console.log(`Removed (no longer on OpenRouter): ${dropped.join(", ")}`);
const fresh = passed.map((r) => ({ id: r.id, label: label(r), vision: r.vision, verified: true }));
const next = {
  ...current,
  checkedAt: new Date().toISOString(),
  // A full run replaces the list; an --only run adds its passes after the verified ones already there.
  models: ONLY ? [...untouched.filter((m) => m.verified), ...fresh, ...untouched.filter((m) => !m.verified)] : fresh,
};
if (!ONLY && untouched.length) {
  // Candidates are the tool-capable free models, so anything not tested here stopped advertising tools.
  console.log(`Not re-tested and removed: ${untouched.map((m) => m.id).join(", ")}`);
}
// Fast model (daily brief, monthly review): the quickest one that wrote a clean brief,
// even if it failed the tool tests, since those jobs don't use tools.
const briefers = results.filter((r) => r.brief).sort((a, b) => a.briefMs - b.briefMs);
if (briefers.length) {
  next.fast = briefers[0].id;
  console.log(`Fast model: ${next.fast} (${briefers[0].briefMs} ms brief).`);
} else if (!byId.has(next.fast) && next.models.length) {
  next.fast = next.models[0].id;
  console.log(`No model wrote a clean brief; fast model set to ${next.fast}. Briefs will use the data-only version when it misbehaves.`);
} else {
  console.log(`No tested model wrote a clean brief; keeping fast model ${next.fast}.`);
}

if (!next.models.length) {
  console.log("No models would be left; verified-models.json left unchanged.");
  process.exit(1);
}
if (DRY) {
  console.log("\n--dry: would write\n" + JSON.stringify(next, null, 2));
} else {
  writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n");
  console.log(`\nWrote ${next.models.length} model(s) to src/lib/ai/verified-models.json (${next.models.filter((m) => m.verified).length} verified). Restart the dev server to see them in Settings.`);
}
if (!next.models.some((m) => m.vision)) console.log("Warning: no passing model reads photos; scans will use the openrouter/free router.");
