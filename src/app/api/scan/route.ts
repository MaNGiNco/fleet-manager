import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Vision-capable model via OpenRouter
const VISION_MODEL = "openai/gpt-4o"; // or "google/gemini-2.0-flash-001", "anthropic/claude-3.5-sonnet"

export async function POST(req: NextRequest) {
  try {
    if (!OPENROUTER_API_KEY) {
      return NextResponse.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });
    }

    const body = await req.json();
    const { imageBase64, mimeType = "image/jpeg" } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const prompt = `You are a document extraction specialist for South African fleet vehicles.
Analyze this photo of a vehicle document (COIDA certificate, Roadworthy certificate, or similar).
Extract the following fields in STRICT JSON format only (no markdown, no explanation):
{
  "document_type": "COIDA" | "Roadworthy" | "License Disc" | "Other" | "Unknown",
  "vehicle_plate": "string or null",
  "vehicle_id": "string or null (fleet internal ID if present)",
  "holder_name": "string or null (company or person name)",
  "issue_date": "YYYY-MM-DD or null",
  "expiry_date": "YYYY-MM-DD or null"
}
If a field cannot be read confidently, use null. Prefer South African plate formats (e.g. CA 123-456, GP 12 AB GP).`;

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
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

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter error:", errText);
      return NextResponse.json({ error: "Vision API failed", details: errText }, { status: 502 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle possible markdown wrapping)
    let extracted: any = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      } else {
        extracted = { raw: content };
      }
    } catch {
      extracted = { raw: content, parse_error: true };
    }

    // Match to vehicle in DB
    const supabase = createServerClient();
    let matchedVehicle = null;

    const plate = extracted.vehicle_plate?.replace(/\s+/g, " ").trim().toUpperCase();
    const vId = extracted.vehicle_id?.trim();

    if (plate || vId) {
      let query = supabase.from("vehicles").select("*");
      if (plate && vId) {
        query = query.or(`plate.ilike.%${plate}%,vehicle_id.ilike.%${vId}%`);
      } else if (plate) {
        query = query.ilike("plate", `%${plate}%`);
      } else if (vId) {
        query = query.ilike("vehicle_id", `%${vId}%`);
      }
      const { data: vehicles } = await query.limit(1);
      if (vehicles && vehicles.length > 0) {
        matchedVehicle = vehicles[0];

        // Optionally update expiry dates if this is a valid cert
        if (extracted.expiry_date && extracted.document_type) {
          const updates: any = {};
          if (extracted.document_type.toUpperCase().includes("COIDA")) {
            updates.coida_expiry = extracted.expiry_date;
          } else if (extracted.document_type.toUpperCase().includes("ROADWORTHY") || extracted.document_type.toUpperCase().includes("ROAD WORTHY")) {
            updates.roadworthy_expiry = extracted.expiry_date;
          }
          if (Object.keys(updates).length > 0) {
            await supabase.from("vehicles").update(updates).eq("id", matchedVehicle.id);
          }
        }
      }
    }

    // Store the scan record
    const { data: scanRecord } = await supabase
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
      .select()
      .single();

    return NextResponse.json({
      success: true,
      extracted,
      matchedVehicle,
      scanId: scanRecord?.id,
    });
  } catch (error: any) {
    console.error("Scan error:", error);
    return NextResponse.json({ error: error.message || "Internal error" }, { status: 500 });
  }
}
