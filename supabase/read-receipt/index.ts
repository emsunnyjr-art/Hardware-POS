// Tindero POS: server-side receipt reader. Triggered by insert into public.pos_ai_jobs.
// Primary: Claude (same ANTHROPIC_API_KEY secret the Telegram shift-report reader uses) — fast and accurate.
// Backup: Google Gemini (key saved from the app). Writes parsed JSON back and clears the photo.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const CLAUDE_MODELS = ["claude-sonnet-5-5", "claude-opus-5"]; // second = the model the Telegram reader already uses
const GEMINI_MODELS = ["gemini-3.8-flash"];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const BUDGET_MS = 140_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildPrompt(cats: string[]) {
  return 'Read this Philippine supplier receipt / sales invoice / delivery receipt (DR) / consignment form for a hardware store and return its data as JSON. ' +
    'name = full item description incl. size/thickness/brand, cleaned to normal capitalization. unit = the unit the qty is counted in (pc, box, bag, roll, bundle, kg, m, sheet, gal, can, set, lt...). ' +
    'pack_qty = how many pieces are inside ONE of that unit only when the line says so for that unit (e.g. qty counted in BOX and "(100 pcs)" -> 100; roll 150m -> 150), otherwise 1. A note like "(10/BOX)" on a line counted in PC/SET is just packaging info: pack_qty 1. ' +
    'piece_unit = unit of those inner pieces (pc, m, kg, ft); same as unit when pack_qty is 1. ' +
    'unit_cost = the NET cost per unit after all line discounts or add-ons = amount / qty (e.g. 36.00 with 30% disc -> 25.20; 2325 with +38% -> 3208.50). amount = the printed line amount. ' +
    'brand = manufacturer/brand if shown, else "". category = best fit from this list: ' + (cats.length ? cats.join(" | ") : "Paint | Plumbing | Electrical | Fasteners | Tools | Steel | Lumber & Plywood | Cement & Masonry | Roofing | Adhesives & Sealants | Uncategorized") + '. ' +
    'item_code = supplier item/product code for the line if printed, else "". barcode = product barcode digits if printed, else "". ' +
    'supplier = the SELLER company name printed at the top (not the buyer). invoice_no = document number. date = document date as YYYY-MM-DD ("" if none). total = grand total printed (0 if none). ' +
    'Numbers only, no commas or currency symbols. Skip VAT, discount, subtotal and total rows as lines. Ignore handwritten notes that have no quantity and price. ' +
    'Before answering, check that qty x unit_cost matches each printed amount and that the amounts add up to the total; re-read any line that does not.';
}

const LINE_PROPS = {
  name: { type: "string" }, qty: { type: "number" }, unit: { type: "string" }, pack_qty: { type: "number" }, piece_unit: { type: "string" },
  brand: { type: "string" }, category: { type: "string" }, item_code: { type: "string" }, barcode: { type: "string" },
  unit_cost: { type: "number" }, amount: { type: "number" },
};
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["supplier", "invoice_no", "date", "total", "lines"],
  properties: {
    supplier: { type: "string" }, invoice_no: { type: "string" }, date: { type: "string" }, total: { type: "number" },
    lines: { type: "array", items: { type: "object", additionalProperties: false, required: Object.keys(LINE_PROPS), properties: LINE_PROPS } },
  },
} as const;

function tidy(o: any) {
  if (Array.isArray(o)) o = { lines: o };
  o.lines = o.lines || o.items || o.line_items || [];
  return o;
}

async function readWithClaude(image: string, mime: string, cats: string[], deadline: number) {
  if (!ANTHROPIC_API_KEY) throw new Error("no Claude key");
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });
  let lastErr = "";
  for (const model of CLAUDE_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > deadline - 10_000) throw new Error(lastErr || "Claude: out of time");
      try {
        const res: any = await client.messages.create({
          model, max_tokens: 8000,
          output_config: { format: { type: "json_schema", schema: SCHEMA } },
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mime as any, data: image } },
            { type: "text", text: buildPrompt(cats) },
          ] }],
        } as any);
        if (res.stop_reason === "refusal") throw new Error("Claude declined this image");
        const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        if (!text.trim()) throw new Error("Claude returned no text");
        return { ...tidy(JSON.parse(text)), _model: model };
      } catch (e: any) {
        const msg = String(e?.message ?? e); lastErr = "Claude: " + msg.slice(0, 200);
        const st = e?.status;
        if (st === 404 || /model/i.test(msg) && st === 400) break;          // model not available -> next model
        if (st === 401 || st === 403 || /credit|billing/i.test(msg)) throw new Error(lastErr); // key/billing -> give up on Claude
        if (st === 429 || st === 529 || (st ?? 500) >= 500) { await sleep([2000, 5000, 9000][attempt]); continue; }
        throw new Error(lastErr);
      }
    }
  }
  throw new Error(lastErr || "Claude unavailable");
}

function parseGemini(j: any) {
  const cand = j?.candidates?.[0];
  const parts = (cand?.content?.parts || []).filter((p: any) => !p.thought && typeof p.text === "string");
  const t = parts.map((p: any) => p.text).join("").replace(/```json|```/g, "").trim();
  if (!t) throw new Error("AI returned no text" + (cand?.finishReason ? " (" + cand.finishReason + ")" : ""));
  try { return tidy(JSON.parse(t)); } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("AI reply was not readable");
    return tidy(JSON.parse(t.slice(a, b + 1)));
  }
}

async function readWithGemini(image: string, mime: string, cats: string[], deadline: number) {
  const { data } = await sb.from("pos_records").select("data").eq("id", "shared_ai").maybeSingle();
  const d: any = data?.data || {};
  // backup key lives server-side only (pos_secrets has no access for the app's sync key)
  const { data: sec } = await sb.from("pos_secrets").select("value").eq("id", "gemini").maybeSingle();
  const key = Deno.env.get("GEMINI_API_KEY") || sec?.value || "";
  if (!key) throw new Error("No Gemini key saved");
  const models = [...new Set([d.aiModel, ...GEMINI_MODELS].filter((m) => m && !/^gemini-(1|2)\./.test(m)))];
  const prompt = buildPrompt(cats) + ' Return ONLY JSON: {"supplier":string,"invoice_no":string,"date":"YYYY-MM-DD","total":number,"lines":[{"name","qty","unit","pack_qty","piece_unit","brand","category","item_code","barcode","unit_cost","amount"}]}';
  let think = true, mi = 0, lastErr = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    const left = deadline - Date.now();
    if (left < 8000) break;
    const m = models[mi] || models[0];
    const gc: any = { responseMimeType: "application/json", temperature: 0 };
    if (think) gc.thinkingConfig = { thinkingLevel: "low" };
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(Math.min(100_000, left - 3000)),
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: image } }] }], generationConfig: gc }),
      });
    } catch (e) { lastErr = (e as Error).name === "TimeoutError" ? "Gemini took too long" : "Network: " + (e as Error).message; await sleep(2000); continue; }
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { ...parseGemini(j), _model: m };
    const msg: string = j?.error?.message || "HTTP " + r.status; lastErr = "Gemini: " + msg;
    if (think && /thinking/i.test(msg)) { think = false; continue; }
    if (/no longer|not found|deprecat|update your code|not supported/i.test(msg)) {
      const um = msg.match(/use\s+(?:the\s+)?models\/([a-z0-9.\-]+)/i);
      const sug = um && um[1];
      if (sug && !models.includes(sug)) { models.push(sug); mi = models.indexOf(sug); continue; }
      if (mi < models.length - 1) { mi++; continue; }
    }
    if (r.status === 429 || r.status >= 500 || /high demand|overloaded|try again|unavailable|exhausted/i.test(msg)) { await sleep([3000, 6000, 10000, 15000, 20000][Math.min(attempt, 4)]); continue; }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || "Gemini did not answer in time");
}

async function loadImage(src: string) {
  let img = String(src || "").trim(), mime = "image/jpeg";
  const dm = img.match(/^data:(image\/[a-z+]+);base64,/i);
  if (dm) { mime = dm[1]; img = img.slice(dm[0].length); }
  else if (/^https?:\/\//i.test(img)) {
    const r = await fetch(img, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("Could not download image (" + r.status + ")");
    mime = (r.headers.get("content-type") || mime).split(";")[0];
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    img = btoa(s);
  } else if (img.startsWith("iVBOR")) mime = "image/png";
  return { img, mime };
}

// ---- Loose (tingi) price suggestion: text-only task, cats = {task:"loose", name, unit, looseUnit, cost, price, brand, contents}
const LOOSE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["contents_estimate", "contents_basis", "loose_price", "reason"],
  properties: { contents_estimate: { type: "number" }, contents_basis: { type: "string" }, loose_price: { type: "number" }, reason: { type: "string" } },
} as const;

function niceRound(v: number) {
  if (!(v > 0)) return 0;
  if (v < 20) return Math.ceil(v * 4 - 1e-9) / 4;
  if (v < 100) return Math.ceil(v - 1e-9);
  if (v < 1000) return Math.ceil(v / 5 - 1e-9) * 5;
  return Math.ceil(v / 10 - 1e-9) * 10;
}

async function suggestLoose(t: any, deadline: number) {
  if (!ANTHROPIC_API_KEY) throw new Error("no Claude key");
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  const known = +t.contents > 0;
  const prompt = "You price items for a small Philippine hardware store (Cavite). An item is stocked as a sealed " + (t.unit || "unit") +
    " and the store also sells it loose (tingi) per " + (t.looseUnit || "pc") + ".\n" +
    "Item: " + t.name + (t.brand ? " (brand: " + t.brand + ")" : "") + "\n" +
    "Cost per " + (t.unit || "unit") + ": PHP " + (+t.cost || 0) + (+t.price > 0 ? "; selling price per " + t.unit + ": PHP " + t.price : "") + "\n" +
    (known ? "Contents per " + t.unit + ": " + t.contents + " " + t.looseUnit + " (known, use it as contents_estimate).\n"
           : "Contents per " + t.unit + " are NOT printed. Estimate the usual contents in " + t.looseUnit + " for this kind of item sold in the Philippines (standard roll lengths, pack counts) and say what you based it on.\n") +
    "loose_price = selling price per " + t.looseUnit + " in PHP: proportional price (whole-unit price, or cost x 1.25 if no price, divided by contents) plus the usual tingi premium of 15-30% for cutting/opening and leftovers, " +
    "never below cost per " + t.looseUnit + " + 20%. Use a price a cashier can charge easily. reason = one short sentence.";
  let lastErr = "";
  for (const model of CLAUDE_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > deadline - 5000) throw new Error(lastErr || "out of time");
      try {
        const res: any = await client.messages.create({
          model, max_tokens: 1500, output_config: { format: { type: "json_schema", schema: LOOSE_SCHEMA } },
          messages: [{ role: "user", content: prompt }],
        } as any);
        const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        const o = JSON.parse(text);
        const c = known ? +t.contents : Math.max(0, +o.contents_estimate || 0);
        const base = +t.price > 0 ? +t.price : (+t.cost || 0) * 1.25;
        const floor = c > 0 ? (+t.cost || 0) / c * 1.2 : 0;
        o.contents_estimate = c;
        o.loose_price = niceRound(Math.max(+o.loose_price || 0, floor, 0) || (c > 0 ? base / c * 1.2 : 0));
        return { ...o, _model: model };
      } catch (e: any) {
        const msg = String(e?.message ?? e); lastErr = "Claude: " + msg.slice(0, 200); const st = e?.status;
        if (st === 404 || /model/i.test(msg) && st === 400) break;
        if (st === 429 || st === 529 || (st ?? 500) >= 500) { await sleep([1500, 4000, 8000][attempt]); continue; }
        throw new Error(lastErr);
      }
    }
  }
  throw new Error(lastErr || "Claude unavailable");
}

// ---- Supplier price list: one page photo (image) or a text chunk (CSV from Excel). cats = {task:"pricelist", text?, cats?}
const PL_LINE = { name: { type: "string" }, color: { type: "string" }, unit: { type: "string" }, cost: { type: "number" }, code: { type: "string" }, brand: { type: "string" }, category: { type: "string" } };
const PL_SCHEMA = {
  type: "object", additionalProperties: false, required: ["supplier", "date", "lines"],
  properties: { supplier: { type: "string" }, date: { type: "string" },
    lines: { type: "array", items: { type: "object", additionalProperties: false, required: Object.keys(PL_LINE), properties: PL_LINE } } },
} as const;

function plPrompt(cats: string[]) {
  return "This is a page of a Philippine hardware / steel / construction-materials SUPPLIER PRICE LIST (or a chunk of one exported from Excel as CSV). Return every priced item as JSON.\n" +
    "name = full item description a hardware store would use, including type, size, thickness/gauge, length, grade, color and brand if shown, normal capitalization " +
    "(e.g. 'Angle Bar 1-1/2\" x 1-1/2\" x 1/4\" (6m)', 'Deformed Bar 10mm x 6m Grade 33', 'GI Sheet Corrugated Ga.26 x 8ft'). Carry section headings into the name when rows only show sizes (a row '1/4 x 1' under heading 'FLAT BAR' -> 'Flat Bar 1/4\" x 1\"'). " +
    "Grid tables (sizes down, lengths/gauges across): one line per priced cell, putting both dimensions in the name. " +
    "color = the color or color code the list gives this item (suppliers often color-code thickness, gauge or grade, e.g. metal furring Red/Green/Blue, square bar Orange/Yellow; also paint and roofing colors), one or two words like 'Red', 'Blue', 'Sky Blue'. When a color heading or color column applies to several rows, give it to each of those rows. '' if none. Keep size/thickness in name; do not put the color in name. Items that differ only by color are different items: output each one. " +
    "unit = what the price is per (pc, length, sheet, kg, bundle, box, roll, m, ft, bag, gal...). If unclear, pc. " +
    "cost = the price shown, numbers only. If several price columns exist, use the one for buying in normal quantity (net / dealer / cash price), not the SRP, and not a bulk-tier price. Skip items with no price. " +
    "code = supplier item code if printed, else ''. brand = brand if shown, else ''. category = best fit from: " + (cats.length ? cats.join(" | ") : "Steel | Roofing | Paint | Plumbing | Electrical | Fasteners | Tools | Lumber & Plywood | Cement & Masonry | Adhesives & Sealants | Uncategorized") + ". " +
    "supplier = supplier company name if printed on this page, else ''. date = effective date of the list as YYYY-MM-DD if printed, else ''. " +
    "Do not invent rows. Read every row on the page, top to bottom.";
}

async function readPriceList(job: { image: string; cats: any }, deadline: number) {
  if (!ANTHROPIC_API_KEY) throw new Error("no Claude key");
  const t = job.cats || {}, cats: string[] = Array.isArray(t.cats) ? t.cats : [];
  const content: any[] = [];
  if (job.image) { const { img, mime } = await loadImage(job.image); content.push({ type: "image", source: { type: "base64", media_type: mime, data: img } }); }
  else if (t.text) content.push({ type: "text", text: "CSV rows from the supplier's Excel price list" + (t.sheet ? " (sheet: " + t.sheet + ")" : "") + ":\n" + String(t.text).slice(0, 60000) });
  else throw new Error("Nothing to read");
  content.push({ type: "text", text: plPrompt(cats) });
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 130_000, maxRetries: 0 });
  let lastErr = "";
  for (const model of CLAUDE_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > deadline - 15_000) throw new Error(lastErr || "out of time");
      try {
        const res: any = await client.messages.create({ model, max_tokens: 16000, output_config: { format: { type: "json_schema", schema: PL_SCHEMA } }, messages: [{ role: "user", content }] } as any);
        if (res.stop_reason === "refusal") throw new Error("Claude declined this page");
        const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        const o = JSON.parse(text); o.lines = (o.lines || []).filter((l: any) => l.name && +l.cost > 0);
        if (res.stop_reason === "max_tokens") o.truncated = true;
        return { ...o, _model: model };
      } catch (e: any) {
        const msg = String(e?.message ?? e); lastErr = "Claude: " + msg.slice(0, 200); const st = e?.status;
        if (st === 404 || /model/i.test(msg) && st === 400) break;
        if (st === 429 || st === 529 || (st ?? 500) >= 500) { await sleep([2000, 5000, 9000][attempt]); continue; }
        throw new Error(lastErr);
      }
    }
  }
  throw new Error(lastErr || "Claude unavailable");
}

async function processJob(job: { id: string; image: string; cats: any }) {
  if (job.cats && !Array.isArray(job.cats) && job.cats.task === "pricelist") {
    try {
      const out: any = await readPriceList(job, Date.now() + BUDGET_MS);
      const model = out._model; delete out._model;
      await sb.from("pos_ai_jobs").update({ status: "done", result: out, model, image: null, cats: { task: "pricelist" }, updated_at: new Date().toISOString() }).eq("id", job.id);
    } catch (e) {
      await sb.from("pos_ai_jobs").update({ status: "error", error: (e as Error).message.slice(0, 500), image: null, cats: { task: "pricelist" }, updated_at: new Date().toISOString() }).eq("id", job.id);
    }
    return;
  }
  if (job.cats && !Array.isArray(job.cats) && job.cats.task === "loose") {
    try {
      const out: any = await suggestLoose(job.cats, Date.now() + 90_000);
      const model = out._model; delete out._model;
      await sb.from("pos_ai_jobs").update({ status: "done", result: out, model, updated_at: new Date().toISOString() }).eq("id", job.id);
    } catch (e) {
      await sb.from("pos_ai_jobs").update({ status: "error", error: (e as Error).message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", job.id);
    }
    return;
  }
  const deadline = Date.now() + BUDGET_MS;
  const cats = Array.isArray(job.cats) ? job.cats : [];
  try {
    const { img, mime } = await loadImage(job.image);
    let out: any, claudeErr = "";
    try { out = await readWithClaude(img, mime, cats, deadline); }
    catch (e) { claudeErr = (e as Error).message; console.warn("claude failed, trying gemini:", claudeErr); }
    if (!out) {
      try { out = await readWithGemini(img, mime, cats, deadline); }
      catch (e) { throw new Error([claudeErr, (e as Error).message].filter(Boolean).join(" | ")); }
    }
    const model = out._model; delete out._model;
    await sb.from("pos_ai_jobs").update({ status: "done", result: out, model, image: null, updated_at: new Date().toISOString() }).eq("id", job.id);
  } catch (e) {
    await sb.from("pos_ai_jobs").update({ status: "error", error: (e as Error).message.slice(0, 500), image: null, updated_at: new Date().toISOString() }).eq("id", job.id);
  }
  await sb.from("pos_ai_jobs").delete().lt("created_at", new Date(Date.now() - 3 * 864e5).toISOString());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let id = "";
  try { id = String((await req.json()).id || ""); } catch { /* empty */ }
  if (!id) return json({ error: "id required" }, 400);
  const { data: job } = await sb.from("pos_ai_jobs").update({ status: "working", updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "queued").select("id,image,cats").maybeSingle();
  if (!job || (!job.image && !(job.cats && (job.cats as any).task))) return json({ ok: true, skipped: true });
  const p = processJob(job as any);
  // @ts-ignore EdgeRuntime is provided by Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p); else await p;
  return json({ ok: true, id }, 202);
});
