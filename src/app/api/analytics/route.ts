import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { calculateRiskScores, kmToNextService, daysUntil } from "@/lib/utils";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "openai/gpt-4o-mini";

export async function POST(req: NextRequest) {
  try {
    if (!OPENROUTER_API_KEY) {
      return NextResponse.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });
    }

    const supabase = createServerClient();

    const { data: vehicles } = await supabase.from("vehicles").select("*");
    const { data: fuelReserve } = await supabase.from("fuel_reserve").select("*").limit(1).single();
    const { data: downVehicles } = await supabase
      .from("vehicles")
      .select("*")
      .in("status", ["maintenance", "accident"]);

    const risks = calculateRiskScores(vehicles || []);
    const highRisk = risks.filter((r) => r.total_risk >= 60);

    const summary = {
      totalVehicles: vehicles?.length || 0,
      active: vehicles?.filter((v) => v.status === "active").length || 0,
      inMaintenance: vehicles?.filter((v) => v.status === "maintenance").length || 0,
      inAccident: vehicles?.filter((v) => v.status === "accident").length || 0,
      highRiskCount: highRisk.length,
      highRiskPlates: highRisk.map((r) => r.plate),
      fuelReserveLiters: fuelReserve?.current_liters || 0,
      certificatesExpiringSoon: (vehicles || []).filter((v) => {
        const c = daysUntil(v.coida_expiry);
        const r = daysUntil(v.roadworthy_expiry);
        return (c !== null && c <= 20) || (r !== null && r <= 20);
      }).map((v) => ({ plate: v.plate, coida: v.coida_expiry, roadworthy: v.roadworthy_expiry })),
      servicesDueSoon: (vehicles || [])
        .filter((v) => kmToNextService(v) < 800)
        .map((v) => ({ plate: v.plate, kmLeft: kmToNextService(v) })),
      estimatedDailyIncomeAtRisk: (downVehicles || []).reduce(
        (s, v) => s + (Number(v.estimated_daily_income) || 0),
        0
      ),
    };

    const prompt = `You are an expert fleet operations analyst helping a South African fleet manager reduce downtime, stay compliant (COIDA & roadworthy), manage bulk fuel, and reallocate vehicles/drivers when units are offline.

Here is the current fleet snapshot:
${JSON.stringify(summary, null, 2)}

High risk vehicles details:
${JSON.stringify(highRisk.slice(0, 8), null, 2)}

Provide concise, actionable recommendations in this exact JSON structure (no markdown):
{
  "priority_actions": ["string", "..."],
  "downtime_mitigation": ["string", "..."],
  "compliance_alerts": ["string", "..."],
  "fuel_recommendations": ["string", "..."],
  "risk_summary": "one paragraph overview",
  "estimated_impact": "short note on potential cost/income savings if actions taken"
}`;

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
        "X-Title": "Fleet Manager Analytics",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: "AI analytics failed", details: err }, { status: 502 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let recommendations: any = {};
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) recommendations = JSON.parse(match[0]);
      else recommendations = { raw: content };
    } catch {
      recommendations = { raw: content };
    }

    return NextResponse.json({
      success: true,
      summary,
      recommendations,
      highRisk,
    });
  } catch (error: any) {
    console.error("Analytics error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
