import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TEXT_MODEL = "openai/gpt-4o-mini";

async function researchDieselPrice(): Promise<number> {
  // Aug 2026 inland diesel ~R26.17 fallback
  let price = 26.17;
  if (!OPENROUTER_API_KEY) return price;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
        "X-Title": "Fleet Manager Fuel Budget",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          {
            role: "user",
            content:
              'Current South Africa inland diesel 500ppm pump price in Rand per litre. STRICT JSON: {"price_per_litre": number}',
          },
        ],
        max_tokens: 80,
        temperature: 0.1,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        const n = Number(JSON.parse(m[0]).price_per_litre);
        if (Number.isFinite(n) && n > 10 && n < 50) price = Math.round(n * 100) / 100;
      }
    }
  } catch {
    /* fallback */
  }
  return price;
}

export async function GET() {
  const supabase = createServerClient();
  const { data } = await supabase.from("fuel_reserve").select("*").limit(1).maybeSingle();
  return NextResponse.json({ success: true, reserve: data });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createServerClient();
    const { data: existing } = await supabase
      .from("fuel_reserve")
      .select("*")
      .limit(1)
      .maybeSingle();

    const mode = body.mode === "budget" ? "budget" : "tank";

    if (mode === "budget") {
      const budget = Number(body.budget_zar);
      if (!Number.isFinite(budget) || budget <= 0) {
        return NextResponse.json({ error: "budget_zar must be a positive number" }, { status: 400 });
      }
      const price = await researchDieselPrice();
      const expectedLiters = Math.round((budget / price) * 10) / 10;
      const row = {
        mode: "budget",
        budget_zar: budget,
        remaining_budget_zar: budget,
        current_liters: expectedLiters,
        capacity_liters: existing?.capacity_liters ?? expectedLiters,
        last_updated: new Date().toISOString(),
        notes: body.notes || `Budget mode @ ~R${price}/L diesel`,
      };
      let saved;
      if (existing?.id) {
        const { data, error } = await supabase
          .from("fuel_reserve")
          .update(row)
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        saved = data;
      } else {
        const { data, error } = await supabase.from("fuel_reserve").insert(row).select("*").single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        saved = data;
      }
      return NextResponse.json({
        success: true,
        reserve: saved,
        researched_price_per_litre: price,
        expected_liters: expectedLiters,
        message: `Budget R${budget.toLocaleString()} ≈ ${expectedLiters} L at R${price}/L`,
      });
    }

    // tank mode
    const liters = Number(body.current_liters);
    const capacity = body.capacity_liters != null ? Number(body.capacity_liters) : existing?.capacity_liters ?? 10000;
    if (!Number.isFinite(liters) || liters < 0) {
      return NextResponse.json({ error: "current_liters required" }, { status: 400 });
    }
    const row = {
      mode: "tank",
      current_liters: liters,
      capacity_liters: capacity,
      budget_zar: null,
      remaining_budget_zar: null,
      last_updated: new Date().toISOString(),
      notes: body.notes || existing?.notes || "Bulk tank",
    };
    let saved;
    if (existing?.id) {
      const { data, error } = await supabase
        .from("fuel_reserve")
        .update(row)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      saved = data;
    } else {
      const { data, error } = await supabase.from("fuel_reserve").insert(row).select("*").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      saved = data;
    }
    return NextResponse.json({ success: true, reserve: saved });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
