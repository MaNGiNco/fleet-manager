import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const VISION_MODEL = "openai/gpt-4o";

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
Analyze this photo of a vehicle document (COIDA certificate, Roadworthy certificate, License Disc, or similar).
Extract the following fields in STRICT JSON format only (no markdown, no explanation):
{
  "document_type": "COIDA" | "Roadworthy" | "License Disc" | "Other" | "Unknown",
  "vehicle_plate": "string or null",
  "vehicle_id": "string or null (fleet internal ID if present, e.g. FLT-001)",
  "holder_name": "string or null (company or person name)",
  "issue_date": "YYYY-MM-DD or null",
  "expiry_date": "YYYY-MM-DD or null"
}
If a field cannot be read confidently, use null.
South African plates may appear as "WC 333-222", "333-222 WC", "CA 123-456", "GP 12 AB GP", etc. Extract the plate text as written, even if slightly unclear.`;

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
          max_tokens: 500,
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
        // Still return extraction; matching failed
      } else if (allVehicles && allVehicles.length > 0) {
        const result = findBestVehicleMatch(allVehicles, extractedPlate, vId);
        if (result) {
          matchedVehicle = result.vehicle;
          matchMeta = { score: result.score, method: result.method };

          // Update expiry dates when confident match + valid dates
          if (
            extracted.expiry_date &&
            typeof extracted.expiry_date === "string" &&
            extracted.document_type
          ) {
            const docType = String(extracted.document_type).toUpperCase();
            if (docType.includes("COIDA")) {
              // Company-level — not stored on the vehicle
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
        }
      }
    } catch (dbErr: any) {
      console.error("Database matching error:", dbErr);
      // Non-fatal: still return extraction results
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

    return NextResponse.json({
      success: true,
      extracted,
      matchedVehicle,
      scanId,
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
