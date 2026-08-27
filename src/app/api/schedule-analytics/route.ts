import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TEXT_MODEL = "openai/gpt-4o-mini";

function overlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number
): boolean {
  return a0 < b1 && b0 < a1;
}

export async function GET() {
  return POST(new NextRequest("http://local", { method: "POST", body: "{}" }));
}

export async function POST(_req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { data: schedules } = await supabase
      .from("schedules")
      .select("*")
      .order("start_time", { ascending: true })
      .limit(200);
    const { data: vehicles } = await supabase.from("vehicles").select("*").limit(500);
    const { data: drivers } = await supabase.from("drivers").select("*").limit(300);
    const { data: fuelTx } = await supabase
      .from("fuel_transactions")
      .select("*")
      .eq("transaction_type", "vehicle_refuel")
      .order("created_at", { ascending: false })
      .limit(100);

    const list = schedules || [];
    const vehMap = new Map((vehicles || []).map((v) => [v.id, v]));
    const drvMap = new Map((drivers || []).map((d) => [d.id, d]));

    // Clash detection
    const clashes: any[] = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!["scheduled", "in_progress"].includes(String(a.status))) continue;
      const a0 = new Date(a.start_time).getTime();
      const a1 = a.end_time
        ? new Date(a.end_time).getTime()
        : a0 + 4 * 3600000;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!["scheduled", "in_progress"].includes(String(b.status))) continue;
        const b0 = new Date(b.start_time).getTime();
        const b1 = b.end_time
          ? new Date(b.end_time).getTime()
          : b0 + 4 * 3600000;
        if (!overlap(a0, a1, b0, b1)) continue;
        if (a.vehicle_id && a.vehicle_id === b.vehicle_id) {
          const v = vehMap.get(a.vehicle_id);
          clashes.push({
            type: "vehicle",
            plate: v?.plate || a.vehicle_id,
            message: `Double-booked vehicle ${v?.plate || a.vehicle_id}`,
            jobs: [a.job_description, b.job_description],
            windows: [a.start_time, b.start_time],
          });
        }
        if (a.driver_id && a.driver_id === b.driver_id) {
          const d = drvMap.get(a.driver_id);
          clashes.push({
            type: "driver",
            driver_name: d?.name || a.driver_id,
            message: `Driver ${d?.name || "unknown"} assigned to overlapping jobs`,
            jobs: [a.job_description, b.job_description],
            windows: [a.start_time, b.start_time],
          });
        }
      }
    }

    // Locations summary
    const locations: Record<string, number> = {};
    for (const s of list) {
      const loc = (s.location || s.job_description || "Unspecified").split("·")[0].trim();
      locations[loc] = (locations[loc] || 0) + 1;
    }
    const topLocations = Object.entries(locations)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Fuel discrepancies vs schedule intensity
    const fuelByVehicle: Record<string, number> = {};
    for (const t of fuelTx || []) {
      if (!t.vehicle_id) continue;
      fuelByVehicle[t.vehicle_id] =
        (fuelByVehicle[t.vehicle_id] || 0) + Number(t.amount_liters || 0);
    }
    const jobsByVehicle: Record<string, number> = {};
    for (const s of list) {
      jobsByVehicle[s.vehicle_id] = (jobsByVehicle[s.vehicle_id] || 0) + 1;
    }
    const fuelFlags: any[] = [];
    for (const [vid, liters] of Object.entries(fuelByVehicle)) {
      const jobs = jobsByVehicle[vid] || 0;
      const v = vehMap.get(vid);
      if (jobs === 0 && liters > 80) {
        fuelFlags.push({
          plate: v?.plate || vid,
          issue: "high_fuel_no_schedule",
          message: `${v?.plate || vid}: ${liters.toFixed(0)} L logged but no active/recent schedule rows`,
        });
      }
      if (jobs >= 3 && liters < 20) {
        fuelFlags.push({
          plate: v?.plate || vid,
          issue: "busy_low_fuel_log",
          message: `${v?.plate || vid}: ${jobs} jobs but only ${liters.toFixed(0)} L fuel logged — slips may be missing`,
        });
      }
    }

    // Optimisation heuristics
    const optimisations: string[] = [];
    if (clashes.length) {
      optimisations.push(
        `Resolve ${clashes.length} clash(es) first — reassign driver or shift start times by 1–2 hours.`
      );
    }
    const byDay: Record<string, number> = {};
    for (const s of list) {
      const day = String(s.start_time).slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    }
    const heavyDays = Object.entries(byDay).filter(([, c]) => c >= 4);
    if (heavyDays.length) {
      optimisations.push(
        `Heavy days: ${heavyDays.map(([d, c]) => `${d} (${c} jobs)`).join(", ")} — stagger departures or split loads.`
      );
    }
    if (topLocations[0] && topLocations[0].count >= 3) {
      optimisations.push(
        `Cluster routes around "${topLocations[0].name}" (${topLocations[0].count} jobs) to cut empty km.`
      );
    }
    if (!optimisations.length) {
      optimisations.push(
        "No major clashes detected. Keep scanning trip sheets after dispatch to keep the calendar live."
      );
    }

    let ai_summary = "";
    if (OPENROUTER_API_KEY) {
      try {
        const snap = {
          total_schedules: list.length,
          clash_count: clashes.length,
          top_locations: topLocations.slice(0, 5),
          fuel_flags: fuelFlags.slice(0, 5),
          optimisations,
        };
        const prompt = `You are a South African fleet scheduler. In 3 short sentences, advise the manager on clashes, fuel/schedule mismatches, and one route optimisation. Data: ${JSON.stringify(snap)}`;
        const res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
            "X-Title": "Fleet Manager Schedule Analytics",
          },
          body: JSON.stringify({
            model: TEXT_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 220,
            temperature: 0.3,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          ai_summary = data.choices?.[0]?.message?.content?.trim() || "";
        }
      } catch {
        /* non-fatal */
      }
    }

    const enriched = list.map((s) => ({
      ...s,
      plate: vehMap.get(s.vehicle_id)?.plate || null,
      vehicle_fleet_id: vehMap.get(s.vehicle_id)?.vehicle_id || null,
      driver_name: s.driver_id ? drvMap.get(s.driver_id)?.name || null : null,
    }));

    return NextResponse.json({
      success: true,
      schedules: enriched,
      clashes,
      top_locations: topLocations,
      fuel_flags: fuelFlags,
      optimisations,
      ai_summary:
        ai_summary ||
        `${list.length} schedule rows · ${clashes.length} clash(es) · review fuel flags and cluster high-frequency locations.`,
      counts: {
        total: list.length,
        clashes: clashes.length,
        fuel_flags: fuelFlags.length,
      },
    });
  } catch (e: any) {
    console.error("schedule-analytics error:", e);
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
