import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TEXT_MODEL = "openai/gpt-4o-mini";

async function researchAvgConsumption(
  make: string,
  model: string,
  year: number | null
): Promise<{ avg: number | null; note: string }> {
  if (!OPENROUTER_API_KEY) {
    return { avg: null, note: "OpenRouter not configured" };
  }
  try {
    const prompt = `Typical real-world combined fuel consumption (L/100km) for a ${year || ""} ${make} ${model} in South African fleet/bakkie use. STRICT JSON only:
{"avg_l_per_100km": number, "note": "one short sentence"}
Number between 5 and 20.`;

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
        "X-Title": "Fleet Manager Fuel Analytics",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        temperature: 0.2,
      }),
    });
    if (!res.ok) return { avg: null, note: "Research API failed" };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { avg: null, note: "Could not parse research" };
    const parsed = JSON.parse(match[0]);
    const n = Number(parsed.avg_l_per_100km);
    if (Number.isFinite(n) && n > 3 && n < 30) {
      return { avg: Math.round(n * 10) / 10, note: String(parsed.note || "") };
    }
    return { avg: null, note: "Invalid research value" };
  } catch (e: any) {
    return { avg: null, note: e?.message || "Research error" };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const vehicleId = body.vehicleId || body.vehicle_id;
    if (!vehicleId) {
      return NextResponse.json({ error: "vehicleId required" }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (vErr || !vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    const { data: txs } = await supabase
      .from("fuel_transactions")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .eq("transaction_type", "vehicle_refuel")
      .order("created_at", { ascending: false })
      .limit(50);

    const refuels = txs || [];
    const totalLiters = refuels.reduce((s, t) => s + (Number(t.amount_liters) || 0), 0);
    const refuelCount = refuels.length;
    const last = refuels[0] || null;
    const avgLiters =
      refuelCount > 0 ? Math.round((totalLiters / refuelCount) * 10) / 10 : null;

    let daysBetween: number | null = null;
    if (refuelCount >= 2) {
      const newest = new Date(refuels[0].created_at).getTime();
      const oldest = new Date(refuels[refuelCount - 1].created_at).getTime();
      const spanDays = Math.max(1, (newest - oldest) / (1000 * 60 * 60 * 24));
      daysBetween = Math.round((spanDays / (refuelCount - 1)) * 10) / 10;
    }

    const research = await researchAvgConsumption(
      vehicle.make || "",
      vehicle.model || "",
      vehicle.year || null
    );

    const fleetEff =
      vehicle.fuel_efficiency_l_per_100km != null
        ? Number(vehicle.fuel_efficiency_l_per_100km)
        : null;

    let consumptionVs: "better" | "inline" | "worse" | "unknown" = "unknown";
    let deltaPct: number | null = null;
    if (fleetEff != null && research.avg != null && research.avg > 0) {
      deltaPct = Math.round(((fleetEff - research.avg) / research.avg) * 1000) / 10;
      if (deltaPct <= -8) consumptionVs = "better";
      else if (deltaPct >= 12) consumptionVs = "worse";
      else consumptionVs = "inline";
    }

    // Impact rating from total liters relative to a soft fleet scale
    let impact: "low" | "medium" | "high" | "critical" = "low";
    if (totalLiters > 2000) impact = "critical";
    else if (totalLiters > 1000) impact = "high";
    else if (totalLiters > 400) impact = "medium";

    const level = vehicle.current_fuel_level_pct != null
      ? Number(vehicle.current_fuel_level_pct)
      : null;

    const summaryParts: string[] = [];
    if (level != null) {
      summaryParts.push(`Current tank ~${level}%.`);
    }
    if (last) {
      summaryParts.push(
        `Last refuel ${Number(last.amount_liters).toFixed(1)} L` +
          (last.station_name ? ` at ${last.station_name}` : "") +
          "."
      );
    }
    if (research.avg != null) {
      summaryParts.push(
        `Researched average for ${vehicle.make} ${vehicle.model}: ${research.avg} L/100km.`
      );
    }
    if (fleetEff != null && research.avg != null) {
      if (consumptionVs === "worse") {
        summaryParts.push(
          `Recorded efficiency (${fleetEff} L/100km) is ~${Math.abs(deltaPct || 0)}% higher than expected — investigate driving style, load, or mechanical issues.`
        );
      } else if (consumptionVs === "better") {
        summaryParts.push(
          `Recorded efficiency (${fleetEff} L/100km) is better than typical for this model.`
        );
      } else {
        summaryParts.push(`Efficiency is in line with model expectations.`);
      }
    }
    if (daysBetween != null) {
      summaryParts.push(`Average ${daysBetween} days between refuels (${refuelCount} fills logged).`);
    }

    const recommendations: string[] = [];
    if (level != null && level < 25) {
      recommendations.push("Tank is low — schedule a refuel before the next long run.");
    }
    if (consumptionVs === "worse") {
      recommendations.push(
        "Compare odometer deltas between fills; high consumption may indicate tyre pressure, idle time, or maintenance need."
      );
    }
    if (refuelCount < 2) {
      recommendations.push(
        "Scan more fuel slips to build a reliable consumption trend for this vehicle."
      );
    }
    if (daysBetween != null && daysBetween < 3 && avgLiters != null && avgLiters > 40) {
      recommendations.push(
        "High fill frequency — check if this unit is overused relative to peers or short-tripping inefficiently."
      );
    }
    if (recommendations.length === 0) {
      recommendations.push("Continue logging fuel slips after each fill for trend accuracy.");
    }

    const analytics = {
      vehicle_id: vehicle.id,
      plate: vehicle.plate,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      current_fuel_level_pct: level,
      last_refuel_liters: last ? Number(last.amount_liters) : null,
      last_refuel_date: last?.created_at || vehicle.last_refuel_date || null,
      refuel_count: refuelCount,
      total_liters_refueled: Math.round(totalLiters * 10) / 10,
      avg_liters_per_refuel: avgLiters,
      days_between_refuels_avg: daysBetween,
      researched_avg_l_per_100km: research.avg,
      research_note: research.note,
      fleet_recorded_efficiency: fleetEff,
      consumption_vs_expected: consumptionVs,
      consumption_delta_pct: deltaPct,
      impact_on_reserve: impact,
      summary: summaryParts.join(" "),
      recommendations,
      recent_refuels: refuels.slice(0, 5).map((t) => ({
        liters: Number(t.amount_liters),
        cost: t.cost,
        date: t.created_at,
        station: t.station_name,
        level_pct: t.fuel_level_after_pct,
        odometer: t.odometer_at_refuel,
      })),
    };

    return NextResponse.json({ success: true, analytics });
  } catch (error: any) {
    console.error("Fuel analytics error:", error);
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}
