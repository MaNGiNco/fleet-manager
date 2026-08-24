import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const VISION_MODEL = "openai/gpt-4o";
const TEXT_MODEL = "openai/gpt-4o-mini";

// ---------------------------------------------------------------------------
// Plate normalization & fuzzy matching helpers
// ---------------------------------------------------------------------------

/** Keep only A–Z / 0–9, uppercase */
function alphanum(s: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
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

/** Core body without SA region codes */
function plateCore(plate: string | null | undefined): string {
  if (!plate) return "";
  const withoutRegion = plate
    .toUpperCase()
    .replace(/\b(CA|GP|WC|KZN|EC|FS|MP|NW|LP|NC)\b/g, " ");
  return withoutRegion.replace(/[^A-Z0-9]/g, "");
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
 * Find best matching vehicle using exact → core → fuzzy → OCR strategies.
 * Minimum fuzzy score threshold: 0.75 (allows ~1–2 character typos on typical plates).
 */
function findBestVehicleMatch(
  vehicles: any[],
  extractedPlate: string | null,
  extractedVehicleId: string | null
): MatchResult | null {
  if (!vehicles.length) return null;

  const normalizedExtracted = normalizePlate(extractedPlate);
  const coreExtracted = plateCore(extractedPlate);
  const alphanumExtracted = alphanum(extractedPlate || "");

  // Use explicit array to avoid TS narrowing issues with mutable null
  const candidates: MatchResult[] = [];

  const consider = (vehicle: any, score: number, method: string) => {
    candidates.push({ vehicle, score, method });
  };

  for (const v of vehicles) {
    const dbPlate = v.plate || "";
    const dbNorm = normalizePlate(dbPlate);
    const dbCore = plateCore(dbPlate);
    const dbAlpha = alphanum(dbPlate);

    // 1. Exact normalized (order-independent)
    if (normalizedExtracted && dbNorm === normalizedExtracted) {
      consider(v, 1.0, "exact_normalized");
      continue;
    }

    // 2. Exact alphanumeric
    if (alphanumExtracted && dbAlpha === alphanumExtracted) {
      consider(v, 0.99, "exact_alphanum");
      continue;
    }

    // 3. Core body match (region code ignored / position-independent)
    if (coreExtracted.length >= 4 && dbCore.length >= 4) {
      if (dbCore === coreExtracted) {
        consider(v, 0.97, "core_exact");
        continue;
      }
      if (dbCore.includes(coreExtracted) || coreExtracted.includes(dbCore)) {
        consider(v, 0.9, "core_contains");
      }
    }

    // 4. Vehicle ID match
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

    // 5. Fuzzy similarity on full alphanumeric plate
    if (alphanumExtracted.length >= 4 && dbAlpha.length >= 4) {
      const sim = similarity(alphanumExtracted, dbAlpha);
      if (sim >= 0.75) {
        consider(v, sim * 0.95, `fuzzy_${sim.toFixed(2)}`);
      }
    }

    // 6. OCR variant fuzzy match
    if (extractedPlate) {
      for (const variant of ocrVariants(extractedPlate)) {
        if (variant.length < 4) continue;
        const sim = similarity(variant, dbAlpha);
        if (sim >= 0.8) {
          consider(v, sim * 0.92, `ocr_fuzzy_${sim.toFixed(2)}`);
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick highest score
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Only accept matches above threshold
  if (best.score >= 0.75) return best;
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
Analyze this photo. It may be a vehicle certificate (COIDA, Roadworthy, License Disc) OR a fuel slip / petrol station receipt / diesel receipt.

Extract STRICT JSON only (no markdown, no explanation):
{
  "document_type": "COIDA" | "Roadworthy" | "License Disc" | "Fuel Slip" | "Other" | "Unknown",
  "vehicle_plate": "string or null",
  "vehicle_id": "string or null (fleet internal ID if present, e.g. FLT-001)",
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
  "transaction_date": "YYYY-MM-DD or null"
}

Rules:
- If this is a fuel slip / receipt, set document_type to "Fuel Slip" and fill liters, cost_zar, odometer, fuel_level_pct (0-100 if shown), station_name, fuel_type, transaction_date.
- fuel_level_pct is the tank percentage AFTER fill if printed; otherwise null.
- price_per_litre is the unit price shown on the slip (R/L) if printed; otherwise null.
- South African plates may appear as "WC 333-222", "333-222 WC", "CA 123-456", "GP 12 AB GP", etc. Extract the plate text as written.
- If a field cannot be read confidently, use null.`;

    let visionResponse: Response;
    try {
      visionResponse = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
          "X-Title": "Fleet Manager Document Scanner",
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 700,
          temperature: 0.1,
        }),
      });
    } catch (networkErr: any) {
      console.error("OpenRouter network error:", networkErr);
      return NextResponse.json(
        { error: "Failed to reach vision API. Please try again.", details: networkErr?.message },
        { status: 502 }
      );
    }

    if (!visionResponse.ok) {
      const errText = await visionResponse.text().catch(() => "");
      console.error("OpenRouter error:", visionResponse.status, errText);
      return NextResponse.json(
        {
          error: "Vision API request failed",
          status: visionResponse.status,
          details: errText.slice(0, 500),
        },
        { status: 502 }
      );
    }

    let data: any;
    try {
      data = await visionResponse.json();
    } catch {
      return NextResponse.json(
        { error: "Vision API returned invalid JSON" },
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

          // Fuel slip path — update fuel level, odometer, create transaction, deduct reserve
          if (matchedVehicle && isFuelSlip(extracted.document_type)) {
            const liters =
              typeof extracted.liters === "number"
                ? extracted.liters
                : Number(extracted.liters) || null;
            const cost =
              typeof extracted.cost_zar === "number"
                ? extracted.cost_zar
                : Number(extracted.cost_zar) || null;
            const odo =
              typeof extracted.odometer === "number"
                ? extracted.odometer
                : Number(extracted.odometer) || null;
            let levelPct =
              typeof extracted.fuel_level_pct === "number"
                ? extracted.fuel_level_pct
                : Number(extracted.fuel_level_pct);
            if (!Number.isFinite(levelPct) || levelPct < 0 || levelPct > 100) {
              levelPct = null;
            }

            const vehicleUpdate: Record<string, unknown> = {
              last_refuel_date: new Date().toISOString(),
            };
            if (levelPct !== null) vehicleUpdate.current_fuel_level_pct = levelPct;
            if (odo !== null && odo > 0) {
              // Only advance odometer if higher than current
              if (!matchedVehicle.current_odometer || odo >= Number(matchedVehicle.current_odometer)) {
                vehicleUpdate.current_odometer = odo;
              }
            }

            await supabase.from("vehicles").update(vehicleUpdate).eq("id", matchedVehicle.id);

            // Refresh matched vehicle snapshot for response
            matchedVehicle = { ...matchedVehicle, ...vehicleUpdate };

            if (liters && liters > 0) {
              await supabase.from("fuel_transactions").insert({
                vehicle_id: matchedVehicle.id,
                amount_liters: liters,
                cost: cost,
                transaction_type: "vehicle_refuel",
                odometer_at_refuel: odo,
                fuel_level_after_pct: levelPct,
                station_name:
                  typeof extracted.station_name === "string" ? extracted.station_name : null,
                notes: extracted.fuel_type
                  ? `Fuel type: ${extracted.fuel_type}`
                  : "From fuel slip scan",
              });

              // Deduct from bulk reserve (best-effort)
              try {
                const { data: reserve } = await supabase
                  .from("fuel_reserve")
                  .select("id, current_liters")
                  .limit(1)
                  .maybeSingle();
                if (reserve?.id != null && reserve.current_liters != null) {
                  const next = Math.max(0, Number(reserve.current_liters) - liters);
                  await supabase
                    .from("fuel_reserve")
                    .update({
                      current_liters: next,
                      last_updated: new Date().toISOString(),
                    })
                    .eq("id", reserve.id);
                }
              } catch (reserveErr) {
                console.error("Fuel reserve update failed:", reserveErr);
              }
            }
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

    return NextResponse.json({
      success: true,
      extracted,
      matchedVehicle,
      scanId,
      researched_avg_l_per_100km: researchedAvg,
      isFuelSlip: fuelSlipDetected,
      priceVerification,
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
