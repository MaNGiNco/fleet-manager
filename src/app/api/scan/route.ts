import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// openai/gpt-4o alias was removed on OpenRouter (only dated snapshots remain).
// Prefer a current vision-capable model; fall back if one provider is unavailable.
const VISION_MODELS = [
  "google/gemini-2.5-flash",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1-mini",
  "openai/gpt-4o-2024-11-20",
] as const;
const TEXT_MODEL = "openai/gpt-4o-mini";

// ---------------------------------------------------------------------------
// Plate normalization & fuzzy matching helpers
// ---------------------------------------------------------------------------

/** SA province / region codes (longest first so KZN beats single letters) */
const SA_REGION_CODES = ["KZN", "CA", "GP", "WC", "EC", "FS", "MP", "NW", "LP", "NC"] as const;

/** Keep only A–Z / 0–9, uppercase */
function alphanum(s: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Split a plate into { region, core } whether the province code is at the
 * front or the back, with or without spaces/hyphens.
 * Examples:
 *   "WC 333-222"  → { region: "WC", core: "333222" }
 *   "333-222 WC"  → { region: "WC", core: "333222" }
 *   "CA123456"    → { region: "CA", core: "123456" }
 *   "123456GP"    → { region: "GP", core: "123456" }
 *   "GP 12 AB GP" → { region: "GP", core: "12AB" }  (duplicate region ignored)
 */
function splitPlateRegion(plate: string | null | undefined): {
  region: string | null;
  core: string;
  raw: string;
} {
  const raw = alphanum(plate || "");
  if (!raw) return { region: null, core: "", raw: "" };

  // Prefer explicit word-boundary region in original string
  const upper = (plate || "").toUpperCase();
  for (const code of SA_REGION_CODES) {
    const re = new RegExp(`(?:^|[^A-Z0-9])${code}(?:[^A-Z0-9]|$)`);
    if (re.test(upper) || upper.startsWith(code) || upper.endsWith(code)) {
      // strip all occurrences of this region from alphanumeric form
      let core = raw;
      // remove leading region
      if (core.startsWith(code)) core = core.slice(code.length);
      // remove trailing region
      if (core.endsWith(code)) core = core.slice(0, -code.length);
      // remove mid (e.g. double GP)
      core = core.split(code).join("");
      if (core.length >= 3) return { region: code, core, raw };
    }
  }

  // Fallback: leading / trailing region on alphanumeric only
  for (const code of SA_REGION_CODES) {
    if (raw.startsWith(code) && raw.length > code.length + 2) {
      return { region: code, core: raw.slice(code.length), raw };
    }
    if (raw.endsWith(code) && raw.length > code.length + 2) {
      return { region: code, core: raw.slice(0, -code.length), raw };
    }
  }

  return { region: null, core: raw, raw };
}

/**
 * Normalize plate for order-independent matching.
 * "WC 333-222" and "333-222 WC" both become sorted tokens.
 */
function normalizePlate(plate: string | null | undefined): string {
  if (!plate) return "";
  const cleaned = plate.toUpperCase().replace(/[^A-Z0-9]/g, " ");
  return cleaned.split(/\s+/).filter(Boolean).sort().join(" ");
}

/** Core body without SA region codes (province front or back) */
function plateCore(plate: string | null | undefined): string {
  return splitPlateRegion(plate).core;
}

/** Canonical comparable key: core only (province position ignored) */
function plateMatchKey(plate: string | null | undefined): string {
  return splitPlateRegion(plate).core;
}

/**
 * Generate alphanumeric variants with province moved front/back so
 * "CA123456" and "123456CA" compare equal under fuzzy matching.
 */
function plateOrderVariants(plate: string | null | undefined): string[] {
  const { region, core, raw } = splitPlateRegion(plate);
  const variants = new Set<string>();
  if (raw) variants.add(raw);
  if (core) variants.add(core);
  if (region && core) {
    variants.add(region + core);
    variants.add(core + region);
  }
  return Array.from(variants).filter(Boolean);
}

/** Levenshtein distance (edit distance) between two strings */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[m][n];
}

/**
 * Fuzzy similarity 0–1 (1 = identical).
 * Uses normalized Levenshtein on alphanumeric-only strings.
 */
function similarity(a: string, b: string): number {
  const x = alphanum(a);
  const y = alphanum(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  const dist = levenshtein(x, y);
  const maxLen = Math.max(x.length, y.length);
  return 1 - dist / maxLen;
}

/** Common OCR substitutions for SA plates */
const OCR_MAP: Record<string, string> = {
  O: "0",
  "0": "O",
  I: "1",
  "1": "I",
  L: "1",
  S: "5",
  "5": "S",
  B: "8",
  "8": "B",
  Z: "2",
  "2": "Z",
  G: "6",
  "6": "G",
};

/** Generate a few OCR-corrected variants of a plate string */
function ocrVariants(plate: string): string[] {
  const base = alphanum(plate);
  const variants = new Set<string>([base]);
  // Single-character OCR swaps
  for (let i = 0; i < base.length; i++) {
    const ch = base[i];
    if (OCR_MAP[ch]) {
      const swapped = base.slice(0, i) + OCR_MAP[ch] + base.slice(i + 1);
      variants.add(swapped);
    }
  }
  return Array.from(variants);
}

interface MatchResult {
  vehicle: any;
  score: number;
  method: string;
}

/**
 * Find best matching vehicle using exact → core → province-reorder → fuzzy → OCR.
 * Province codes (CA, GP, WC, …) may appear at the front OR back of the plate;
 * matching is driven primarily by the plate body (core).
 * Minimum score threshold: 0.72.
 */
function findBestVehicleMatch(
  vehicles: any[],
  extractedPlate: string | null,
  extractedVehicleId: string | null
): MatchResult | null {
  if (!vehicles.length) return null;

  const normalizedExtracted = normalizePlate(extractedPlate);
  const splitExtracted = splitPlateRegion(extractedPlate);
  const coreExtracted = splitExtracted.core;
  const alphanumExtracted = alphanum(extractedPlate || "");
  const extractedVariants = plateOrderVariants(extractedPlate);

  const candidates: MatchResult[] = [];

  const consider = (vehicle: any, score: number, method: string) => {
    candidates.push({ vehicle, score, method });
  };

  for (const v of vehicles) {
    const dbPlate = v.plate || "";
    const dbNorm = normalizePlate(dbPlate);
    const splitDb = splitPlateRegion(dbPlate);
    const dbCore = splitDb.core;
    const dbAlpha = alphanum(dbPlate);
    const dbVariants = plateOrderVariants(dbPlate);

    // 1. Exact normalized (token-order independent: "WC 333" == "333 WC")
    if (normalizedExtracted && dbNorm === normalizedExtracted) {
      consider(v, 1.0, "exact_normalized");
      continue;
    }

    // 2. Exact alphanumeric (identical string after stripping punctuation)
    if (alphanumExtracted && dbAlpha === alphanumExtracted) {
      consider(v, 0.99, "exact_alphanum");
      continue;
    }

    // 3. Province-reordered alphanumeric equality
    //    e.g. extracted "333222WC" vs DB "WC333222"
    let orderHit = false;
    for (const ev of extractedVariants) {
      for (const dv of dbVariants) {
        if (ev && dv && ev === dv) {
          consider(v, 0.98, "province_reorder_exact");
          orderHit = true;
          break;
        }
      }
      if (orderHit) break;
    }
    if (orderHit) continue;

    // 4. Core body match (region code ignored — province front or back)
    if (coreExtracted.length >= 3 && dbCore.length >= 3) {
      if (dbCore === coreExtracted) {
        // Same body; region may differ or be missing on one side
        const regionBonus =
          splitExtracted.region &&
          splitDb.region &&
          splitExtracted.region === splitDb.region
            ? 0.99
            : 0.96;
        consider(v, regionBonus, "core_exact");
        continue;
      }
      // One core contains the other (partial OCR of body)
      if (
        (dbCore.length >= 4 && coreExtracted.length >= 4) &&
        (dbCore.includes(coreExtracted) || coreExtracted.includes(dbCore))
      ) {
        consider(v, 0.88, "core_contains");
      }
      // Fuzzy on core only (ignores province position entirely)
      const coreSim = similarity(coreExtracted, dbCore);
      if (coreSim >= 0.8) {
        consider(v, coreSim * 0.94, `core_fuzzy_${coreSim.toFixed(2)}`);
      }
    }

    // 5. Vehicle ID / fleet ID match
    if (extractedVehicleId && v.vehicle_id) {
      const idA = extractedVehicleId.toUpperCase().trim();
      const idB = String(v.vehicle_id).toUpperCase().trim();
      if (idA === idB) {
        consider(v, 0.98, "vehicle_id_exact");
        continue;
      }
      if (idA.includes(idB) || idB.includes(idA)) {
        consider(v, 0.88, "vehicle_id_partial");
      }
    }

    // 6. Fuzzy similarity across province-order variants
    let bestFuzzy = 0;
    for (const ev of extractedVariants) {
      if (ev.length < 4) continue;
      for (const dv of dbVariants) {
        if (dv.length < 4) continue;
        const sim = similarity(ev, dv);
        if (sim > bestFuzzy) bestFuzzy = sim;
      }
    }
    if (bestFuzzy >= 0.75) {
      consider(v, bestFuzzy * 0.93, `fuzzy_reorder_${bestFuzzy.toFixed(2)}`);
    }

    // 7. OCR substitution variants (O/0, I/1, …) against DB variants
    if (extractedPlate) {
      for (const variant of ocrVariants(extractedPlate)) {
        if (variant.length < 4) continue;
        for (const dv of dbVariants) {
          const sim = similarity(variant, dv);
          if (sim >= 0.8) {
            consider(v, sim * 0.9, `ocr_fuzzy_${sim.toFixed(2)}`);
          }
        }
        // Also compare OCR variant core vs DB core
        const vCore = plateCore(variant);
        if (vCore.length >= 3 && dbCore.length >= 3) {
          const sim = similarity(vCore, dbCore);
          if (sim >= 0.8) {
            consider(v, sim * 0.91, `ocr_core_${sim.toFixed(2)}`);
          }
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.score >= 0.72) return best;
  return null;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB decoded
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

function validateScanInput(body: any): { ok: true; imageBase64: string; mimeType: string } | { ok: false; status: number; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Request body must be a JSON object" };
  }

  const { imageBase64, mimeType } = body;

  if (imageBase64 === undefined || imageBase64 === null) {
    return { ok: false, status: 400, error: "Missing required field: imageBase64" };
  }

  if (typeof imageBase64 !== "string") {
    return { ok: false, status: 400, error: "imageBase64 must be a string" };
  }

  if (!imageBase64.trim()) {
    return { ok: false, status: 400, error: "imageBase64 cannot be empty" };
  }

  // Strip data-URL prefix if client sent full data URL
  let pureBase64 = imageBase64.trim();
  let detectedMime = typeof mimeType === "string" ? mimeType.toLowerCase().trim() : "image/jpeg";

  const dataUrlMatch = pureBase64.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    detectedMime = dataUrlMatch[1].toLowerCase();
    pureBase64 = dataUrlMatch[2];
  }

  // Remove whitespace/newlines that sometimes appear in base64
  pureBase64 = pureBase64.replace(/\s/g, "");

  // Basic base64 character check
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(pureBase64)) {
    return {
      ok: false,
      status: 400,
      error: "imageBase64 is not valid Base64. Send raw base64 or a data URL.",
    };
  }

  // Approximate decoded size (base64 is ~4/3 of binary)
  const approxBytes = Math.floor((pureBase64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      status: 400,
      error: `Image too large (~${Math.round(approxBytes / 1024 / 1024)} MB). Maximum is 8 MB.`,
    };
  }

  if (approxBytes < 100) {
    return { ok: false, status: 400, error: "Image data is too small to be a valid photo" };
  }

  if (!ALLOWED_MIME.has(detectedMime)) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported image type: ${detectedMime}. Allowed: JPEG, PNG, WebP, GIF, HEIC.`,
    };
  }

  return { ok: true, imageBase64: pureBase64, mimeType: detectedMime };
}

function isFuelSlip(docType: string | null | undefined): boolean {
  if (!docType) return false;
  const t = String(docType).toUpperCase();
  return (
    t.includes("FUEL") ||
    t.includes("PETROL") ||
    t.includes("DIESEL") ||
    t.includes("SLIP") ||
    t.includes("RECEIPT") ||
    t.includes("FORECOURT")
  );
}

function isServiceDoc(docType: string | null | undefined): boolean {
  if (!docType) return false;
  const t = String(docType).toUpperCase();
  return (
    t.includes("SERVICE") ||
    t.includes("JOB CARD") ||
    t.includes("JOBCARD") ||
    t.includes("WORK ORDER") ||
    t.includes("WORKORDER") ||
    t.includes("INVOICE") && (t.includes("SERVICE") || t.includes("WORKSHOP") || t.includes("MAINTENANCE")) ||
    t.includes("MAINTENANCE")
  );
}

function isScheduleDoc(docType: string | null | undefined): boolean {
  if (!docType) return false;
  const t = String(docType).toUpperCase();
  // Avoid treating pure service workshop docs as schedules
  if (t.includes("SERVICE RECORD") || (t.includes("SERVICE") && t.includes("RECORD"))) return false;
  if (t.includes("ROADWORTHY") || t.includes("COIDA") || t.includes("LICENSE")) return false;
  if (t.includes("FUEL") || t.includes("PETROL") || t.includes("DIESEL") && t.includes("SLIP")) return false;
  return (
    t.includes("SCHEDULE") ||
    t.includes("DISPATCH") ||
    t.includes("DELIVERY") ||
    t.includes("TRIP SHEET") ||
    t.includes("TRIP") ||
    t.includes("RUN SHEET") ||
    t.includes("JOB SHEET") ||
    t.includes("ROUTE") ||
    t === "JOB" ||
    t.includes("ASSIGNMENT")
  );
}

function timesOverlap(
  aStart: number,
  aEnd: number | null,
  bStart: number,
  bEnd: number | null
): boolean {
  const aE = aEnd ?? aStart + 4 * 3600000; // default 4h window
  const bE = bEnd ?? bStart + 4 * 3600000;
  return aStart < bE && bStart < aE;
}


/** Typical service interval (km) for make/model via OpenRouter */
async function researchServiceIntervalKm(
  make: string,
  model: string,
  year: number | null
): Promise<{ interval_km: number; note: string }> {
  const fallback = { interval_km: 5000, note: "Default fleet interval 5000 km" };
  if (!OPENROUTER_API_KEY) return fallback;
  try {
    const prompt = `For a ${year || ""} ${make} ${model} used as a South African commercial bakkie/fleet vehicle, what is the typical recommended service interval in kilometres (not months)? Reply STRICT JSON only:
{"interval_km": number, "note": "brief e.g. OEM schedule minor service"}
Use a realistic value between 5000 and 20000. Prefer minor/intermediate service interval if multiple exist.`;

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
        "X-Title": "Fleet Manager Service Interval Research",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        temperature: 0.2,
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    const n = Number(parsed.interval_km);
    if (Number.isFinite(n) && n >= 3000 && n <= 25000) {
      return {
        interval_km: Math.round(n / 500) * 500, // snap to 500 km
        note: String(parsed.note || "AI researched OEM-style interval"),
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** Research typical L/100km for make/model/year via OpenRouter text model */
async function researchAvgConsumption(
  make: string,
  model: string,
  year: number | null
): Promise<number | null> {
  if (!OPENROUTER_API_KEY) return null;
  try {
    const prompt = `What is the typical combined real-world fuel consumption in litres per 100 km for a ${year || ""} ${make} ${model} as used in South Africa (bakkie/pickup or commercial fleet context if applicable)? Reply with STRICT JSON only:
{"avg_l_per_100km": number, "source_note": "brief"}
Use a realistic number between 5 and 20. If unknown, still give your best estimate.`;

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
        "X-Title": "Fleet Manager Fuel Research",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.2,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const n = Number(parsed.avg_l_per_100km);
    if (Number.isFinite(n) && n > 3 && n < 30) return Math.round(n * 10) / 10;
    return null;
  } catch {
    return null;
  }
}


/** Current SA inland pump prices (ZAR/L) via OpenRouter, with hard fallback for Aug 2026 */
async function researchCurrentFuelPrices(fuelTypeHint?: string | null): Promise<{
  petrol_93: number;
  petrol_95: number;
  diesel_500ppm: number;
  diesel_50ppm: number;
  region: string;
  effective: string;
  source_note: string;
  selected_price: number;
  selected_label: string;
}> {
  // Official-ish inland defaults effective ~5 Aug 2026 (DMPR)
  const fallback = {
    petrol_93: 25.42,
    petrol_95: 25.58,
    diesel_500ppm: 26.17,
    diesel_50ppm: 26.9,
    region: "inland",
    effective: "2026-08-05",
    source_note: "Fallback DMPR-aligned inland prices (Aug 2026)",
  };

  const pick = (p: typeof fallback) => {
    const hint = (fuelTypeHint || "").toLowerCase();
    if (hint.includes("diesel") || hint.includes("50ppm") || hint.includes("500")) {
      if (hint.includes("50") && !hint.includes("500")) {
        return { selected_price: p.diesel_50ppm, selected_label: "Diesel 50ppm inland" };
      }
      return { selected_price: p.diesel_500ppm, selected_label: "Diesel 500ppm inland" };
    }
    if (hint.includes("93")) {
      return { selected_price: p.petrol_93, selected_label: "Petrol 93 inland" };
    }
    if (hint.includes("95") || hint.includes("petrol") || hint.includes("ulp")) {
      return { selected_price: p.petrol_95, selected_label: "Petrol 95 inland" };
    }
    // Fleet default: diesel is most common for bakkies
    return { selected_price: p.diesel_500ppm, selected_label: "Diesel 500ppm inland (assumed)" };
  };

  if (!OPENROUTER_API_KEY) {
    const sel = pick(fallback);
    return { ...fallback, ...sel };
  }

  try {
    const prompt = `What are the current official South African inland (Gauteng) pump fuel prices in Rand per litre as of today?
Reply with STRICT JSON only (no markdown):
{
  "petrol_93": number,
  "petrol_95": number,
  "diesel_500ppm": number,
  "diesel_50ppm": number,
  "region": "inland",
  "effective": "YYYY-MM-DD",
  "source_note": "brief source e.g. DMPR Aug 2026"
}
Use realistic regulated prices. Diesel may be wholesale guideline + retail margin.`;

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
        "X-Title": "Fleet Manager Fuel Price Research",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 250,
        temperature: 0.1,
      }),
    });
    if (!res.ok) {
      const sel = pick(fallback);
      return { ...fallback, ...sel, source_note: "API failed; using fallback Aug 2026 prices" };
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      const sel = pick(fallback);
      return { ...fallback, ...sel };
    }
    const parsed = JSON.parse(match[0]);
    const clamp = (n: any, def: number) => {
      const v = Number(n);
      return Number.isFinite(v) && v > 10 && v < 50 ? Math.round(v * 100) / 100 : def;
    };
    const prices = {
      petrol_93: clamp(parsed.petrol_93, fallback.petrol_93),
      petrol_95: clamp(parsed.petrol_95, fallback.petrol_95),
      diesel_500ppm: clamp(parsed.diesel_500ppm, fallback.diesel_500ppm),
      diesel_50ppm: clamp(parsed.diesel_50ppm, fallback.diesel_50ppm),
      region: typeof parsed.region === "string" ? parsed.region : "inland",
      effective: typeof parsed.effective === "string" ? parsed.effective : fallback.effective,
      source_note: typeof parsed.source_note === "string" ? parsed.source_note : "OpenRouter research",
    };
    const sel = pick(prices);
    return { ...prices, ...sel };
  } catch {
    const sel = pick(fallback);
    return { ...fallback, ...sel };
  }
}

/**
 * Verify slip litres vs cost using researched unit price.
 * Also derives implied unit price from slip (cost/liters) for comparison.
 */
function verifyFuelLitresVsSpend(opts: {
  liters: number | null;
  costZar: number | null;
  researchedPricePerLitre: number;
  priceLabel: string;
  sourceNote: string;
}): {
  slip_liters: number | null;
  cost_zar: number | null;
  researched_price_per_litre: number;
  researched_price_label: string;
  price_source: string;
  implied_price_per_litre: number | null;
  expected_liters_from_cost: number | null;
  liters_delta: number | null;
  liters_delta_pct: number | null;
  match_status: "match" | "under_liters" | "over_liters" | "insufficient_data";
  message: string;
} {
  const { liters, costZar, researchedPricePerLitre, priceLabel, sourceNote } = opts;
  const result = {
    slip_liters: liters,
    cost_zar: costZar,
    researched_price_per_litre: researchedPricePerLitre,
    researched_price_label: priceLabel,
    price_source: sourceNote,
    implied_price_per_litre: null as number | null,
    expected_liters_from_cost: null as number | null,
    liters_delta: null as number | null,
    liters_delta_pct: null as number | null,
    match_status: "insufficient_data" as "match" | "under_liters" | "over_liters" | "insufficient_data",
    message: "Need both litres and amount spent on the slip to verify.",
  };

  if (liters != null && liters > 0 && costZar != null && costZar > 0) {
    result.implied_price_per_litre = Math.round((costZar / liters) * 100) / 100;
  }

  if (costZar != null && costZar > 0 && researchedPricePerLitre > 0) {
    result.expected_liters_from_cost =
      Math.round((costZar / researchedPricePerLitre) * 100) / 100;
  }

  if (
    liters != null &&
    liters > 0 &&
    result.expected_liters_from_cost != null
  ) {
    const delta = Math.round((liters - result.expected_liters_from_cost) * 100) / 100;
    const pct = Math.round((delta / result.expected_liters_from_cost) * 1000) / 10;
    result.liters_delta = delta;
    result.liters_delta_pct = pct;

    // Tolerance: ±5% or ±1.5 L (whichever is larger relative buffer)
    const tolPct = 5;
    const tolAbs = 1.5;
    if (Math.abs(pct) <= tolPct || Math.abs(delta) <= tolAbs) {
      result.match_status = "match";
      result.message = `Litres on slip (${liters} L) align with spend at ${priceLabel} (~R${researchedPricePerLitre}/L). Expected ~${result.expected_liters_from_cost} L.`;
    } else if (delta < 0) {
      result.match_status = "under_liters";
      result.message = `Slip shows ${liters} L but spend of R${costZar} at ~R${researchedPricePerLitre}/L (${priceLabel}) should buy ~${result.expected_liters_from_cost} L (${delta} L / ${pct}%). Check OCR, station premium, or under-delivery.`;
    } else {
      result.match_status = "over_liters";
      result.message = `Slip shows ${liters} L but spend of R${costZar} at ~R${researchedPricePerLitre}/L suggests ~${result.expected_liters_from_cost} L only (+${delta} L / +${pct}%). Possible OCR error or discounted price.`;
    }
  } else if (result.implied_price_per_litre != null) {
    result.message = `Implied pump price from slip: R${result.implied_price_per_litre}/L vs researched ${priceLabel} R${researchedPricePerLitre}/L.`;
    const diff = Math.abs(result.implied_price_per_litre - researchedPricePerLitre);
    if (diff <= 1.5) result.match_status = "match";
    else if (result.implied_price_per_litre > researchedPricePerLitre + 1.5)
      result.match_status = "under_liters";
    else result.match_status = "over_liters";
  }

  return result;
}


// ---------------------------------------------------------------------------
// API route
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    if (!OPENROUTER_API_KEY) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY not configured on the server" },
        { status: 500 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body. Send Content-Type: application/json" },
        { status: 400 }
      );
    }

    const validation = validateScanInput(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const { imageBase64, mimeType } = validation;

    const prompt = `You are a document extraction specialist for South African fleet vehicles.
Analyze this photo. It may be:
- a vehicle certificate (COIDA, Roadworthy, License Disc),
- a fuel slip / petrol station receipt / diesel receipt, OR
- a service / maintenance document (job card, workshop invoice, service report, work order), OR
- a schedule / dispatch / delivery / trip sheet / job assignment.

Extract STRICT JSON only (no markdown, no explanation):
{
  "document_type": "COIDA" | "Roadworthy" | "License Disc" | "Fuel Slip" | "Service Record" | "Schedule" | "Other" | "Unknown",
  "vehicle_plate": "string or null",
  "vehicle_id": "string or null (fleet internal ID if present, e.g. FLT-001)",
  "fleet_id": "string or null (same as vehicle_id / fleet unit number if shown)",
  "holder_name": "string or null (company or person name)",
  "issue_date": "YYYY-MM-DD or null",
  "expiry_date": "YYYY-MM-DD or null",
  "liters": number or null,
  "cost_zar": number or null,
  "odometer": number or null,
  "fuel_level_pct": number or null,
  "station_name": "string or null",
  "fuel_type": "diesel" | "petrol" | "diesel 50ppm" | "diesel 500ppm" | "petrol 93" | "petrol 95" | null,
  "price_per_litre": number or null,
  "transaction_date": "YYYY-MM-DD or null",
  "service_reason": "string or null (e.g. 5000km service, oil change, clutch, brakes)",
  "service_date": "YYYY-MM-DD or null",
  "next_service_due_km": number or null,
  "job_type": "string or null (delivery, collection, shuttle, inspection, etc.)",
  "job_date": "YYYY-MM-DD or null",
  "job_time": "HH:MM or null (24h)",
  "job_end_time": "HH:MM or null",
  "driver_name": "string or null",
  "driver_id": "string or null",
  "location": "string or null (delivery/site address or area)",
  "delivery_status": "scheduled" | "in_progress" | "completed" | "delivered" | "failed" | "cancelled" | null,
  "vehicle_status": "active" | "maintenance" | "accident" | "inactive" | null,
  "driver_status": "available" | "assigned" | "off" | null
}

Rules:
- If this is a fuel slip / receipt, set document_type to "Fuel Slip" and fill liters, cost_zar, odometer, fuel_level_pct, station_name, fuel_type, transaction_date.
- If this is a service job card / workshop invoice / service report, set document_type to "Service Record" and fill vehicle_plate, vehicle_id, fleet_id, odometer (current reading at service), service_reason, service_date, cost_zar if present, next_service_due_km if printed.
- If this is a schedule / dispatch / delivery note / trip sheet / job assignment, set document_type to "Schedule" and fill job_type, job_date, job_time, job_end_time, vehicle_plate and/or vehicle_id/fleet_id, driver_name and/or driver_id, location, delivery_status.
- vehicle_status: set when the document clearly states the vehicle is in maintenance, accident/repair, inactive, or back to active.
- driver_status: set when the document clearly states the driver is available, assigned, or off (leave/off day).
- fuel_level_pct is the tank percentage AFTER fill if printed; otherwise null.
- price_per_litre is the unit price shown on the slip (R/L) if printed; otherwise null.
- South African plates may appear with the province code at the FRONT or the BACK, with or without spaces/hyphens, e.g. "WC 333-222", "333-222 WC", "CA 123-456", "123-456 CA", "GP 12 AB GP", "CA123456", "123456GP". Extract the plate text as written (do not reorder). Matching treats province front/back as the same vehicle.
- If a field cannot be read confidently, use null.`;

    const imageDataUrl = `data:${mimeType};base64,${imageBase64}`;
    const visionPayloadBase = {
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: prompt },
            {
              type: "image_url" as const,
              image_url: {
                url: imageDataUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 900,
      temperature: 0.1,
    };

    let data: any = null;
    let lastError: { status: number; details: string; model: string } | null = null;

    for (const model of VISION_MODELS) {
      let visionResponse: Response;
      try {
        visionResponse = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer":
              process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
            "X-Title": "Fleet Manager Document Scanner",
          },
          body: JSON.stringify({ ...visionPayloadBase, model }),
        });
      } catch (networkErr: any) {
        console.error("OpenRouter network error:", model, networkErr);
        lastError = {
          status: 502,
          details: networkErr?.message || "Network error",
          model,
        };
        continue;
      }

      if (!visionResponse.ok) {
        const errText = await visionResponse.text().catch(() => "");
        console.error("OpenRouter error:", model, visionResponse.status, errText);
        lastError = {
          status: visionResponse.status,
          details: errText.slice(0, 800),
          model,
        };
        // Retry next model on model-not-found / invalid model / provider outage
        if (
          visionResponse.status === 400 ||
          visionResponse.status === 404 ||
          visionResponse.status === 429 ||
          visionResponse.status === 502 ||
          visionResponse.status === 503
        ) {
          continue;
        }
        break;
      }

      try {
        data = await visionResponse.json();
      } catch {
        lastError = {
          status: 502,
          details: "Vision API returned invalid JSON",
          model,
        };
        continue;
      }

      // OpenRouter sometimes returns 200 with an error object
      if (data?.error) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : data.error?.message || JSON.stringify(data.error);
        console.error("OpenRouter body error:", model, msg);
        lastError = { status: 502, details: String(msg).slice(0, 800), model };
        continue;
      }

      // Success
      lastError = null;
      break;
    }

    if (!data || lastError) {
      let friendly =
        "Vision API request failed. Check OPENROUTER_API_KEY and account credits.";
      const details = lastError?.details || "";
      if (/invalid model|model not found|not found/i.test(details)) {
        friendly =
          "Vision model unavailable on OpenRouter. The app will try alternate models on retry.";
      } else if (/credit|balance|payment|quota|limit/i.test(details)) {
        friendly =
          "OpenRouter account has insufficient credits or hit a rate limit. Top up at openrouter.ai.";
      } else if (/unauthorized|invalid api key|401/i.test(details) || lastError?.status === 401) {
        friendly =
          "Invalid or missing OPENROUTER_API_KEY. Set it in Vercel environment variables.";
      }
      return NextResponse.json(
        {
          error: friendly,
          status: lastError?.status || 502,
          details: details.slice(0, 500),
          tried_models: [...VISION_MODELS],
          last_model: lastError?.model || null,
        },
        { status: 502 }
      );
    }

    const content = data.choices?.[0]?.message?.content || "";
    if (!content.trim()) {
      return NextResponse.json(
        {
          error: "Vision model returned an empty response. Try a clearer photo of the document.",
          success: false,
        },
        { status: 422 }
      );
    }

    let extracted: any = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      } else {
        extracted = { raw: content, parse_error: true };
      }
    } catch {
      extracted = { raw: content, parse_error: true };
    }

    if (extracted.parse_error) {
      return NextResponse.json({
        success: false,
        error: "Could not parse structured data from the document. Try a clearer, well-lit photo.",
        extracted,
        matchedVehicle: null,
      });
    }

    // --- Flexible + fuzzy plate matching ---
    const supabase = createServerClient();
    let matchedVehicle = null;
    let scheduleUpdatePayload: any = null;
    let matchMeta: { score: number; method: string } | null = null;

    const extractedPlate =
      typeof extracted.vehicle_plate === "string"
        ? extracted.vehicle_plate.replace(/\s+/g, " ").trim()
        : null;
    const vId =
      typeof extracted.vehicle_id === "string" ? extracted.vehicle_id.trim() : null;

    try {
      const { data: allVehicles, error: fetchError } = await supabase
        .from("vehicles")
        .select("*")
        .limit(500);

      if (fetchError) {
        console.error("Supabase vehicles fetch error:", fetchError);
      } else if (allVehicles && allVehicles.length > 0) {
        const result = findBestVehicleMatch(allVehicles, extractedPlate, vId);
        if (result) {
          matchedVehicle = result.vehicle;
          matchMeta = { score: result.score, method: result.method };

          const docType = String(extracted.document_type || "").toUpperCase();

          // Certificate path (existing behaviour)
          if (
            extracted.expiry_date &&
            typeof extracted.expiry_date === "string" &&
            extracted.document_type
          ) {
            if (docType.includes("COIDA")) {
              const { data: existing } = await supabase
                .from("company_compliance")
                .select("id")
                .limit(1)
                .maybeSingle();
              if (existing?.id) {
                await supabase
                  .from("company_compliance")
                  .update({
                    coida_expiry: extracted.expiry_date,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", existing.id);
              } else {
                await supabase.from("company_compliance").insert({
                  coida_expiry: extracted.expiry_date,
                });
              }
            } else if (
              matchedVehicle &&
              (docType.includes("ROADWORTHY") || docType.includes("ROAD WORTHY"))
            ) {
              const { error: updateErr } = await supabase
                .from("vehicles")
                .update({ roadworthy_expiry: extracted.expiry_date })
                .eq("id", matchedVehicle.id);
              if (updateErr) {
                console.error("Failed to update vehicle roadworthy:", updateErr);
              }
            }
          }



          // Explicit vehicle / driver status from any document type
          {
            const vsRaw = String(extracted.vehicle_status || "").toLowerCase().trim();
            const allowedVehicle = new Set(["active", "maintenance", "accident", "inactive"]);
            if (matchedVehicle && allowedVehicle.has(vsRaw) && vsRaw !== matchedVehicle.status) {
              const { error: stErr } = await supabase
                .from("vehicles")
                .update({ status: vsRaw, updated_at: new Date().toISOString() })
                .eq("id", matchedVehicle.id);
              if (stErr) console.error("Vehicle status update failed:", stErr);
              else {
                matchedVehicle = { ...matchedVehicle, status: vsRaw };
                console.log("[Status] Vehicle", matchedVehicle.plate, "→", vsRaw);
              }
            }

            const dsRaw = String(extracted.driver_status || "").toLowerCase().trim();
            const allowedDriver = new Set(["available", "assigned", "off"]);
            if (allowedDriver.has(dsRaw)) {
              let driverIdForStatus = matchedVehicle?.assigned_driver_id || null;
              // Prefer driver named on document
              const dn =
                typeof extracted.driver_name === "string" ? extracted.driver_name.trim() : null;
              if (dn) {
                try {
                  const { data: drows } = await supabase.from("drivers").select("id, name").limit(300);
                  const hit = (drows || []).find(
                    (d: any) => String(d.name || "").toUpperCase() === dn.toUpperCase()
                  ) || (drows || []).find((d: any) =>
                    String(d.name || "").toUpperCase().includes(dn.toUpperCase())
                  );
                  if (hit) driverIdForStatus = hit.id;
                } catch { /* ignore */ }
              }
              if (driverIdForStatus) {
                const { error: dsErr } = await supabase
                  .from("drivers")
                  .update({ status: dsRaw })
                  .eq("id", driverIdForStatus);
                if (dsErr) console.error("Driver status update failed:", dsErr);
                else console.log("[Status] Driver", driverIdForStatus, "→", dsRaw);
              }
            }
          }

          // Schedule / dispatch / delivery path
          if (isScheduleDoc(extracted.document_type) || String(extracted.document_type || "").toUpperCase() === "SCHEDULE") {
            // Resolve vehicle: already matched, or by fleet/vehicle_id field
            let scheduleVehicle = matchedVehicle;
            if (!scheduleVehicle) {
              const fleetHint =
                (typeof extracted.fleet_id === "string" && extracted.fleet_id) ||
                (typeof extracted.vehicle_id === "string" && extracted.vehicle_id) ||
                null;
              if (fleetHint && allVehicles) {
                const hit = allVehicles.find(
                  (v: any) =>
                    String(v.vehicle_id || "").toUpperCase() === fleetHint.toUpperCase() ||
                    String(v.plate || "").toUpperCase().replace(/\s/g, "") ===
                      fleetHint.toUpperCase().replace(/\s/g, "")
                );
                if (hit) {
                  scheduleVehicle = hit;
                  matchedVehicle = hit;
                }
              }
            }

            // Resolve driver by name or id
            let scheduleDriver: any = null;
            const driverName =
              typeof extracted.driver_name === "string" ? extracted.driver_name.trim() : null;
            const driverIdExt =
              typeof extracted.driver_id === "string" ? extracted.driver_id.trim() : null;
            try {
              const { data: allDrivers } = await supabase.from("drivers").select("*").limit(300);
              if (allDrivers && allDrivers.length) {
                if (driverIdExt) {
                  scheduleDriver =
                    allDrivers.find(
                      (d: any) =>
                        String(d.id) === driverIdExt ||
                        String(d.license_number || "").toUpperCase() === driverIdExt.toUpperCase()
                    ) || null;
                }
                if (!scheduleDriver && driverName) {
                  const n = driverName.toUpperCase();
                  scheduleDriver =
                    allDrivers.find((d: any) => String(d.name || "").toUpperCase() === n) ||
                    allDrivers.find((d: any) => String(d.name || "").toUpperCase().includes(n)) ||
                    allDrivers.find((d: any) => n.includes(String(d.name || "").toUpperCase())) ||
                    null;
                }
              }
            } catch (de) {
              console.error("Driver lookup for schedule failed:", de);
            }

            // Build start/end timestamps
            const jobDate =
              (typeof extracted.job_date === "string" && extracted.job_date) ||
              (typeof extracted.transaction_date === "string" && extracted.transaction_date) ||
              (typeof extracted.issue_date === "string" && extracted.issue_date) ||
              new Date().toISOString().slice(0, 10);
            const jobTime =
              typeof extracted.job_time === "string" && /^\d{1,2}:\d{2}/.test(extracted.job_time)
                ? extracted.job_time.slice(0, 5)
                : "08:00";
            const jobEndTime =
              typeof extracted.job_end_time === "string" && /^\d{1,2}:\d{2}/.test(extracted.job_end_time)
                ? extracted.job_end_time.slice(0, 5)
                : null;

            const startIso = new Date(`${jobDate}T${jobTime}:00`).toISOString();
            let endIso: string | null = null;
            if (jobEndTime) {
              endIso = new Date(`${jobDate}T${jobEndTime}:00`).toISOString();
              // if end before start, assume next day
              if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
                const e = new Date(endIso);
                e.setDate(e.getDate() + 1);
                endIso = e.toISOString();
              }
            } else {
              const e = new Date(startIso);
              e.setHours(e.getHours() + 4);
              endIso = e.toISOString();
            }

            const jobType =
              typeof extracted.job_type === "string" ? extracted.job_type : null;
            const location =
              typeof extracted.location === "string" ? extracted.location : null;
            const deliveryStatusRaw = String(extracted.delivery_status || "scheduled").toLowerCase();
            const allowedStatus = new Set([
              "scheduled",
              "in_progress",
              "completed",
              "cancelled",
              "delivered",
              "failed",
            ]);
            const status = allowedStatus.has(deliveryStatusRaw) ? deliveryStatusRaw : "scheduled";
            const jobDescription = [jobType, location].filter(Boolean).join(" · ") || "Scheduled job";

            const clashes: any[] = [];
            if (scheduleVehicle || scheduleDriver) {
              try {
                const startMs = new Date(startIso).getTime();
                const endMs = endIso ? new Date(endIso).getTime() : null;
                const { data: existing } = await supabase
                  .from("schedules")
                  .select("*")
                  .in("status", ["scheduled", "in_progress"])
                  .limit(200);
                for (const s of existing || []) {
                  const sStart = new Date(s.start_time).getTime();
                  const sEnd = s.end_time ? new Date(s.end_time).getTime() : null;
                  if (!timesOverlap(startMs, endMs, sStart, sEnd)) continue;
                  if (scheduleVehicle && s.vehicle_id === scheduleVehicle.id) {
                    clashes.push({
                      type: "vehicle",
                      message: `Vehicle ${scheduleVehicle.plate} already booked in this window`,
                      existing_schedule_id: s.id,
                      existing_start: s.start_time,
                      existing_end: s.end_time,
                      existing_job: s.job_description,
                      plate: scheduleVehicle.plate,
                    });
                  }
                  if (scheduleDriver && s.driver_id === scheduleDriver.id) {
                    clashes.push({
                      type: "driver",
                      message: `Driver ${scheduleDriver.name} already assigned in this window`,
                      existing_schedule_id: s.id,
                      existing_start: s.start_time,
                      existing_end: s.end_time,
                      existing_job: s.job_description,
                      driver_name: scheduleDriver.name,
                    });
                  }
                }
              } catch (ce) {
                console.error("Clash check failed:", ce);
              }
            }

            let createdSchedule: any = null;
            if (scheduleVehicle) {
              const insertRow: any = {
                vehicle_id: scheduleVehicle.id,
                driver_id: scheduleDriver?.id || scheduleVehicle.assigned_driver_id || null,
                start_time: startIso,
                end_time: endIso,
                job_description: jobDescription,
                status,
                location,
                job_type: jobType,
              };
              const { data: created, error: schErr } = await supabase
                .from("schedules")
                .insert(insertRow)
                .select("*")
                .single();
              if (schErr) {
                console.error("Schedule insert failed:", schErr);
              } else {
                createdSchedule = created;
                // Keep vehicle↔driver assignment in sync when we know both
                if (scheduleDriver?.id) {
                  await supabase
                    .from("vehicles")
                    .update({
                      assigned_driver_id: scheduleDriver.id,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", scheduleVehicle.id);
                  await supabase
                    .from("drivers")
                    .update({ status: "assigned" })
                    .eq("id", scheduleDriver.id);
                }
              }
            }

            scheduleUpdatePayload = {
              created: createdSchedule,
              clashes,
              vehicle_plate: scheduleVehicle?.plate || extractedPlate,
              fleet_id: scheduleVehicle?.vehicle_id || extracted.fleet_id || extracted.vehicle_id,
              driver_name: scheduleDriver?.name || driverName,
              driver_id: scheduleDriver?.id || null,
              job_type: jobType,
              location,
              start_time: startIso,
              end_time: endIso,
              status,
              has_clashes: clashes.length > 0,
            };
          }

          // Service record path — update odometer, last service, AI service interval
          if (matchedVehicle && isServiceDoc(extracted.document_type)) {
            const priorLastServiceOdo = matchedVehicle.last_service_odometer ?? null;
            const priorLastServiceDate = matchedVehicle.last_service_date ?? null;
            const priorInterval = matchedVehicle.service_interval_km ?? 5000;

            const odoRaw =
              typeof extracted.odometer === "number"
                ? extracted.odometer
                : Number(extracted.odometer);
            const odo =
              Number.isFinite(odoRaw) && odoRaw > 0 ? odoRaw : null;

            const serviceDate =
              (typeof extracted.service_date === "string" && extracted.service_date) ||
              (typeof extracted.issue_date === "string" && extracted.issue_date) ||
              (typeof extracted.transaction_date === "string" && extracted.transaction_date) ||
              new Date().toISOString().slice(0, 10);

            const serviceReason =
              typeof extracted.service_reason === "string"
                ? extracted.service_reason
                : null;

            const intervalResearch = await researchServiceIntervalKm(
              matchedVehicle.make || "",
              matchedVehicle.model || "",
              matchedVehicle.year || null
            );

            let intervalKm = intervalResearch.interval_km;
            const nextDueRaw =
              typeof extracted.next_service_due_km === "number"
                ? extracted.next_service_due_km
                : Number(extracted.next_service_due_km);
            if (Number.isFinite(nextDueRaw) && nextDueRaw > 0 && odo != null && nextDueRaw > odo) {
              const derived = Math.round((nextDueRaw - odo) / 500) * 500;
              if (derived >= 3000) intervalKm = derived;
            }

            const vehicleUpdate: Record<string, unknown> = {
              service_interval_km: intervalKm,
              updated_at: new Date().toISOString(),
            };

            if (odo != null) {
              vehicleUpdate.current_odometer = odo;
              vehicleUpdate.last_service_odometer = odo;
              vehicleUpdate.last_service_date = serviceDate;
            }

            if (serviceReason) {
              const prevNotes = matchedVehicle.notes ? String(matchedVehicle.notes) : "";
              const noteLine = `Service ${serviceDate}: ${serviceReason} @ ${odo ?? "?"} km`;
              vehicleUpdate.notes = prevNotes
                ? `${prevNotes}\n${noteLine}`.slice(0, 2000)
                : noteLine;
            }

            if (matchedVehicle.status === "maintenance") {
              vehicleUpdate.status = "active";
            }

            const { error: svcErr } = await supabase
              .from("vehicles")
              .update(vehicleUpdate)
              .eq("id", matchedVehicle.id);
            if (svcErr) {
              console.error("Service record vehicle update failed:", svcErr);
            } else {
              console.log(
                "[Service] Updated",
                matchedVehicle.plate,
                "last_service_odo=",
                odo,
                "interval=",
                intervalKm
              );
            }

            matchedVehicle = { ...matchedVehicle, ...vehicleUpdate };
            (matchedVehicle as any).__serviceUpdate = {
              previous_service_odometer: priorLastServiceOdo,
              previous_service_date: priorLastServiceDate,
              previous_interval_km: priorInterval,
              new_service_odometer: odo,
              service_date: serviceDate,
              service_reason: serviceReason,
              researched_interval_km: intervalKm,
              interval_note: intervalResearch.note,
              km_to_next_service: intervalKm, // just serviced
              plate: matchedVehicle.plate,
              vehicle_id: matchedVehicle.vehicle_id,
              fleet_id:
                (typeof extracted.fleet_id === "string" && extracted.fleet_id) ||
                matchedVehicle.vehicle_id,
            };
          }

                    // Fuel slip path — ALWAYS update fuel level + odometer, create transaction, deduct reserve
          if (matchedVehicle && isFuelSlip(extracted.document_type)) {
            const litersRaw =
              typeof extracted.liters === "number"
                ? extracted.liters
                : Number(extracted.liters);
            const liters =
              Number.isFinite(litersRaw) && litersRaw > 0 ? litersRaw : null;
            const costRaw =
              typeof extracted.cost_zar === "number"
                ? extracted.cost_zar
                : Number(extracted.cost_zar);
            const cost =
              Number.isFinite(costRaw) && costRaw > 0 ? costRaw : null;
            const odoRaw =
              typeof extracted.odometer === "number"
                ? extracted.odometer
                : Number(extracted.odometer);
            const odo =
              Number.isFinite(odoRaw) && odoRaw > 0 ? odoRaw : null;

            let levelPct: number | null = null;
            const levelRaw =
              typeof extracted.fuel_level_pct === "number"
                ? extracted.fuel_level_pct
                : Number(extracted.fuel_level_pct);
            if (Number.isFinite(levelRaw) && levelRaw >= 0 && levelRaw <= 100) {
              levelPct = Math.round(levelRaw * 10) / 10;
            } else if (liters != null) {
              // Estimate tank % when slip has litres but no gauge reading.
              // Typical SA bakkie/LDV tank ~70–90 L; use 80 L default.
              const tankLiters = 80;
              const prev =
                matchedVehicle.current_fuel_level_pct != null
                  ? Number(matchedVehicle.current_fuel_level_pct)
                  : 15;
              if (liters >= tankLiters * 0.55) {
                // Large fill → treat as near-full
                levelPct = Math.min(100, Math.round((70 + (liters / tankLiters) * 30) * 10) / 10);
              } else {
                const addedPct = (liters / tankLiters) * 100;
                levelPct = Math.min(100, Math.round((prev + addedPct) * 10) / 10);
              }
            }

            const vehicleUpdate: Record<string, unknown> = {
              last_refuel_date: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            // Always write fuel level when we have a value (slip or estimated)
            if (levelPct !== null) {
              vehicleUpdate.current_fuel_level_pct = levelPct;
            }
            if (odo !== null) {
              if (
                !matchedVehicle.current_odometer ||
                odo >= Number(matchedVehicle.current_odometer)
              ) {
                vehicleUpdate.current_odometer = odo;
              }
            }

            const { error: vehUpdateErr } = await supabase
              .from("vehicles")
              .update(vehicleUpdate)
              .eq("id", matchedVehicle.id);
            if (vehUpdateErr) {
              console.error("Failed to update vehicle fuel level:", vehUpdateErr);
            } else {
              console.log(
                "[Fuel] Updated vehicle",
                matchedVehicle.plate,
                "fuel_level_pct=",
                levelPct,
                "odo=",
                vehicleUpdate.current_odometer
              );
            }

            // Refresh matched vehicle snapshot for response
            matchedVehicle = { ...matchedVehicle, ...vehicleUpdate };

            let fuelTxId: string | null = null;
            if (liters != null) {
              const { data: txRow, error: txErr } = await supabase
                .from("fuel_transactions")
                .insert({
                  vehicle_id: matchedVehicle.id,
                  amount_liters: liters,
                  cost: cost,
                  transaction_type: "vehicle_refuel",
                  odometer_at_refuel: odo,
                  fuel_level_after_pct: levelPct,
                  station_name:
                    typeof extracted.station_name === "string"
                      ? extracted.station_name
                      : null,
                  notes: extracted.fuel_type
                    ? `Fuel type: ${extracted.fuel_type}`
                    : "From fuel slip scan",
                })
                .select("id")
                .single();
              if (txErr) {
                console.error("Fuel transaction insert failed:", txErr);
              } else {
                fuelTxId = txRow?.id ?? null;
              }

              // Deduct from bulk reserve (tank litres and/or budget Rands)
              try {
                const { data: reserve } = await supabase
                  .from("fuel_reserve")
                  .select("id, current_liters, remaining_budget_zar, budget_zar, mode")
                  .limit(1)
                  .maybeSingle();
                if (reserve?.id != null) {
                  const patch: Record<string, unknown> = {
                    last_updated: new Date().toISOString(),
                  };
                  const mode = String(reserve.mode || "tank");
                  if (mode === "budget" || reserve.remaining_budget_zar != null) {
                    const spend = cost != null && cost > 0 ? cost : 0;
                    if (spend > 0 && reserve.remaining_budget_zar != null) {
                      patch.remaining_budget_zar = Math.max(
                        0,
                        Number(reserve.remaining_budget_zar) - spend
                      );
                    }
                    // Also track litres equivalent when possible
                    if (liters > 0 && reserve.current_liters != null) {
                      patch.current_liters = Math.max(0, Number(reserve.current_liters) - liters);
                    }
                  } else {
                    patch.current_liters = Math.max(0, Number(reserve.current_liters || 0) - liters);
                  }
                  await supabase.from("fuel_reserve").update(patch).eq("id", reserve.id);
                  console.log("[Fuel] Reserve deducted", patch);
                }
              } catch (reserveErr) {
                console.error("Fuel reserve update failed:", reserveErr);
              }
            }

            // Stash for fraud path after price verification (outside match block we still have IDs)
            (matchedVehicle as any).__fuelTxId = fuelTxId;
            (matchedVehicle as any).__levelPct = levelPct;
            (matchedVehicle as any).__liters = liters;
            (matchedVehicle as any).__cost = cost;
          }
        }
      }
    } catch (dbErr: any) {
      console.error("Database matching error:", dbErr);
    }

    // Store scan record (best-effort)
    let scanId: string | null = null;
    try {
      const { data: scanRecord, error: insertErr } = await supabase
        .from("document_scans")
        .insert({
          vehicle_id: matchedVehicle?.id || null,
          document_type: extracted.document_type || null,
          plate: extracted.vehicle_plate || null,
          vehicle_id_extracted: extracted.vehicle_id || null,
          holder_name: extracted.holder_name || null,
          issue_date: extracted.issue_date || null,
          expiry_date: extracted.expiry_date || null,
          raw_extraction: extracted,
        })
        .select("id")
        .single();

      if (insertErr) {
        console.error("Failed to store scan record:", insertErr);
      } else {
        scanId = scanRecord?.id ?? null;
      }
    } catch (insertCatch: any) {
      console.error("Scan insert exception:", insertCatch);
    }

    // Optional: research avg consumption + current fuel prices when fuel slip
    let researchedAvg: number | null = null;
    let priceVerification: any = null;
    const fuelSlipDetected = isFuelSlip(extracted.document_type);

    if (fuelSlipDetected) {
      const litersNum =
        typeof extracted.liters === "number"
          ? extracted.liters
          : Number(extracted.liters);
      const costNum =
        typeof extracted.cost_zar === "number"
          ? extracted.cost_zar
          : Number(extracted.cost_zar);
      const liters =
        Number.isFinite(litersNum) && litersNum > 0 ? litersNum : null;
      const costZar =
        Number.isFinite(costNum) && costNum > 0 ? costNum : null;

      const prices = await researchCurrentFuelPrices(
        typeof extracted.fuel_type === "string" ? extracted.fuel_type : null
      );
      priceVerification = verifyFuelLitresVsSpend({
        liters,
        costZar,
        researchedPricePerLitre: prices.selected_price,
        priceLabel: prices.selected_label,
        sourceNote: prices.source_note,
      });
      // Attach full price board for UI
      priceVerification.price_board = {
        petrol_93: prices.petrol_93,
        petrol_95: prices.petrol_95,
        diesel_500ppm: prices.diesel_500ppm,
        diesel_50ppm: prices.diesel_50ppm,
        region: prices.region,
        effective: prices.effective,
      };

      // Flag fraud when litres vs spend do not match (beyond tolerance)
      if (
        priceVerification.match_status === "under_liters" ||
        priceVerification.match_status === "over_liters"
      ) {
        const driverId = matchedVehicle?.assigned_driver_id || null;
        let driverName = "Driver";
        let driverPhone: string | null = null;
        if (driverId) {
          try {
            const { data: drv } = await supabase
              .from("drivers")
              .select("id, name, phone")
              .eq("id", driverId)
              .maybeSingle();
            if (drv?.name) driverName = drv.name;
            if (drv?.phone) driverPhone = drv.phone;
          } catch (e) {
            console.error("Driver lookup for fraud flag failed:", e);
          }
        } else if (matchedVehicle?.id) {
          // Fallback: any driver currently assigned in schedules is not needed; leave generic
        }

        const script = `Hi ${driverName}, the manager is kindly requesting an urgent meeting with you within the next 24hrs. May I note your response?`;

        const severity =
          Math.abs(Number(priceVerification.liters_delta_pct) || 0) >= 20
            ? "critical"
            : Math.abs(Number(priceVerification.liters_delta_pct) || 0) >= 10
            ? "high"
            : "medium";

        let fraudFlagId: string | null = null;
        try {
          const { data: flagRow, error: flagErr } = await supabase
            .from("fraud_flags")
            .insert({
              vehicle_id: matchedVehicle?.id || null,
              driver_id: driverId,
              fuel_transaction_id: (matchedVehicle as any)?.__fuelTxId || null,
              document_scan_id: null, // filled after scan insert if needed
              plate: matchedVehicle?.plate || extractedPlate,
              reason: priceVerification.message,
              match_status: priceVerification.match_status,
              slip_liters: priceVerification.slip_liters,
              expected_liters: priceVerification.expected_liters_from_cost,
              cost_zar: priceVerification.cost_zar,
              researched_price_per_litre: priceVerification.researched_price_per_litre,
              liters_delta: priceVerification.liters_delta,
              severity,
              status: "open",
              voice_note_script: script,
              notes: `Auto-flagged from fuel slip scan. Implied R${priceVerification.implied_price_per_litre}/L vs researched R${priceVerification.researched_price_per_litre}/L.`,
            })
            .select("id")
            .single();
          if (flagErr) {
            console.error("Fraud flag insert failed:", flagErr);
          } else {
            fraudFlagId = flagRow?.id ?? null;
          }
        } catch (fe) {
          console.error("Fraud flag exception:", fe);
        }

        priceVerification.fraud_flagged = true;
        priceVerification.fraud_flag_id = fraudFlagId;
        priceVerification.severity = severity;
        priceVerification.voice_note = {
          script,
          driver_name: driverName,
          driver_id: driverId,
          driver_phone: driverPhone,
          voice: "celeste", // calm confident female
          status: "pending_send",
        };
      } else {
        priceVerification.fraud_flagged = false;
      }
    }

    let fraudAlert: any = null;
    if (
      fuelSlipDetected &&
      priceVerification &&
      (priceVerification.match_status === "under_liters" ||
        priceVerification.match_status === "over_liters")
    ) {
      try {
        let driverName = "Driver";
        let driverPhone: string | null = null;
        let driverId: string | null = null;
        if (matchedVehicle?.assigned_driver_id) {
          const { data: drv } = await supabase
            .from("drivers")
            .select("*")
            .eq("id", matchedVehicle.assigned_driver_id)
            .maybeSingle();
          if (drv) {
            driverName = drv.name || driverName;
            driverPhone = drv.phone || null;
            driverId = drv.id;
          }
        }
        // Fallback: try any driver linked via schedules if no assigned driver
        if (!driverId && matchedVehicle?.id) {
          const { data: sched } = await supabase
            .from("schedules")
            .select("driver_id, drivers(id, name, phone)")
            .eq("vehicle_id", matchedVehicle.id)
            .order("start_time", { ascending: false })
            .limit(1)
            .maybeSingle();
          const d: any = (sched as any)?.drivers;
          if (d) {
            driverName = d.name || driverName;
            driverPhone = d.phone || null;
            driverId = d.id || null;
          }
        }

        const script = `Hi ${driverName}, the manager is kindly requesting an urgent meeting with you within the next 24 hours. May I note your response?`;
        const reason = `Fuel slip fraud flag: ${priceVerification.match_status}. ${priceVerification.message}`;
        const row = {
          vehicle_id: matchedVehicle?.id || null,
          driver_id: driverId,
          document_scan_id: scanId,
          plate: matchedVehicle?.plate || extractedPlate || null,
          driver_name: driverName,
          driver_phone: driverPhone,
          match_status: priceVerification.match_status,
          slip_liters: priceVerification.slip_liters,
          expected_liters: priceVerification.expected_liters_from_cost,
          cost_zar: priceVerification.cost_zar,
          researched_price_per_litre: priceVerification.researched_price_per_litre,
          liters_delta: priceVerification.liters_delta,
          liters_delta_pct: priceVerification.liters_delta_pct,
          reason,
          voice_script: script,
          voice_note_status: "pending",
          status: "open",
        };
        const { data: alertRow, error: alertErr } = await supabase
          .from("fraud_alerts")
          .insert(row)
          .select("*")
          .single();
        if (alertErr) {
          fraudAlert = {
            id: `demo-${Date.now()}`,
            ...row,
            voice_sent_at: null,
            voice_acknowledged_at: null,
            driver_response: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            _demo: true,
            _dbError: alertErr.message,
          };
        } else {
          fraudAlert = alertRow;
        }
      } catch (fraudErr: any) {
        console.error("Fraud alert create failed:", fraudErr);
        fraudAlert = {
          id: `demo-${Date.now()}`,
          plate: matchedVehicle?.plate || extractedPlate,
          match_status: priceVerification.match_status,
          reason: priceVerification.message,
          voice_script: `Hi Driver, the manager is kindly requesting an urgent meeting with you within the next 24 hours. May I note your response?`,
          voice_note_status: "pending",
          status: "open",
          driver_name: "Driver",
          _demo: true,
        };
      }
    }

    if (matchedVehicle && fuelSlipDetected) {
      researchedAvg = await researchAvgConsumption(
        matchedVehicle.make || "",
        matchedVehicle.model || "",
        matchedVehicle.year || null
      );
      // Persist efficiency if we got a solid number and vehicle has none
      if (
        researchedAvg != null &&
        matchedVehicle.id &&
        (matchedVehicle.fuel_efficiency_l_per_100km == null ||
          matchedVehicle.fuel_efficiency_l_per_100km === 0)
      ) {
        try {
          await supabase
            .from("vehicles")
            .update({ fuel_efficiency_l_per_100km: researchedAvg })
            .eq("id", matchedVehicle.id);
          matchedVehicle = {
            ...matchedVehicle,
            fuel_efficiency_l_per_100km: researchedAvg,
          };
        } catch {
          /* non-fatal */
        }
      }
    }

    const serviceUpdate = (matchedVehicle as any)?.__serviceUpdate || null;
    const scheduleUpdate = scheduleUpdatePayload;
    const isService = isServiceDoc(extracted.document_type);
    const isSchedule =
      isScheduleDoc(extracted.document_type) ||
      String(extracted.document_type || "").toUpperCase() === "SCHEDULE";

    return NextResponse.json({
      success: true,
      extracted,
      matchedVehicle,
      scanId,
      researched_avg_l_per_100km: researchedAvg,
      isFuelSlip: fuelSlipDetected,
      isServiceRecord: isService,
      isSchedule,
      serviceUpdate,
      scheduleUpdate,
      priceVerification,
      fraudAlert,
      matchInfo: {
        normalizedPlate: normalizePlate(extractedPlate),
        corePlate: plateCore(extractedPlate),
        score: matchMeta?.score ?? null,
        method: matchMeta?.method ?? null,
        matched: Boolean(matchedVehicle),
      },
    });
  } catch (error: any) {
    console.error("Scan unhandled error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
