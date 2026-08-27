import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TEXT_MODEL = "openai/gpt-4o-mini";

function overlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function endMs(s: { start_time: string; end_time?: string | null }): number {
  const a0 = new Date(s.start_time).getTime();
  return s.end_time ? new Date(s.end_time).getTime() : a0 + 4 * 3600000;
}

function statusRank(status: string): number {
  const s = String(status || "").toLowerCase();
  if (s === "in_progress") return 0;
  if (s === "scheduled") return 1;
  if (s === "delivered") return 2;
  if (s === "completed") return 3;
  if (s === "failed") return 4;
  if (s === "cancelled") return 5;
  return 6;
}

/** Shift a job forward until it no longer overlaps conflicting jobs on same vehicle/driver */
function resolveClashShift(
  job: any,
  others: any[],
  shiftHoursStep = 1,
  maxSteps = 12
): { start_time: string; end_time: string | null; hours_shifted: number } | null {
  const duration = endMs(job) - new Date(job.start_time).getTime();
  for (let step = 1; step <= maxSteps; step++) {
    const newStart = new Date(job.start_time);
    newStart.setHours(newStart.getHours() + step * shiftHoursStep);
    const newEnd = new Date(newStart.getTime() + duration);
    const a0 = newStart.getTime();
    const a1 = newEnd.getTime();
    let conflict = false;
    for (const o of others) {
      if (o.id === job.id) continue;
      if (!["scheduled", "in_progress"].includes(String(o.status))) continue;
      const sameVehicle = job.vehicle_id && o.vehicle_id === job.vehicle_id;
      const sameDriver = job.driver_id && o.driver_id === job.driver_id;
      if (!sameVehicle && !sameDriver) continue;
      if (overlap(a0, a1, new Date(o.start_time).getTime(), endMs(o))) {
        conflict = true;
        break;
      }
    }
    if (!conflict) {
      return {
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
        hours_shifted: step * shiftHoursStep,
      };
    }
  }
  return null;
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
      .limit(300);
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

    // Clash detection with schedule ids for apply
    const clashes: any[] = [];
    const clashPairs: { a: any; b: any; type: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!["scheduled", "in_progress"].includes(String(a.status))) continue;
      const a0 = new Date(a.start_time).getTime();
      const a1 = endMs(a);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!["scheduled", "in_progress"].includes(String(b.status))) continue;
        const b0 = new Date(b.start_time).getTime();
        const b1 = endMs(b);
        if (!overlap(a0, a1, b0, b1)) continue;
        if (a.vehicle_id && a.vehicle_id === b.vehicle_id) {
          const v = vehMap.get(a.vehicle_id);
          clashes.push({
            type: "vehicle",
            plate: v?.plate || a.vehicle_id,
            message: `Double-booked vehicle ${v?.plate || a.vehicle_id}`,
            jobs: [a.job_description, b.job_description],
            windows: [a.start_time, b.start_time],
            schedule_ids: [a.id, b.id],
          });
          clashPairs.push({ a, b, type: "vehicle" });
        }
        if (a.driver_id && a.driver_id === b.driver_id) {
          const d = drvMap.get(a.driver_id);
          clashes.push({
            type: "driver",
            driver_name: d?.name || a.driver_id,
            message: `Driver ${d?.name || "unknown"} assigned to overlapping jobs`,
            jobs: [a.job_description, b.job_description],
            windows: [a.start_time, b.start_time],
            schedule_ids: [a.id, b.id],
          });
          clashPairs.push({ a, b, type: "driver" });
        }
      }
    }

    // Clash recommendations: shift the later-starting job
    const clash_recommendations: any[] = [];
    const seenJobIds = new Set<string>();
    for (const pair of clashPairs) {
      const later =
        new Date(pair.a.start_time).getTime() >= new Date(pair.b.start_time).getTime()
          ? pair.a
          : pair.b;
      if (seenJobIds.has(later.id)) continue;
      // Don't shift in_progress — shift the other if possible
      let toShift = later;
      if (String(later.status) === "in_progress") {
        toShift = later.id === pair.a.id ? pair.b : pair.a;
        if (String(toShift.status) === "in_progress") continue;
      }
      const resolved = resolveClashShift(toShift, list);
      if (!resolved) continue;
      seenJobIds.add(toShift.id);
      const v = vehMap.get(toShift.vehicle_id);
      const d = toShift.driver_id ? drvMap.get(toShift.driver_id) : null;
      clash_recommendations.push({
        kind: "clash",
        schedule_id: toShift.id,
        plate: v?.plate || null,
        driver_name: d?.name || null,
        job_description: toShift.job_description,
        current_start: toShift.start_time,
        current_end: toShift.end_time,
        proposed_start: resolved.start_time,
        proposed_end: resolved.end_time,
        hours_shifted: resolved.hours_shifted,
        summary: `Move "${toShift.job_description || "job"}" (+${resolved.hours_shifted}h) to clear ${pair.type} clash`,
      });
    }

    // Heavy days
    const byDay: Record<string, any[]> = {};
    for (const s of list) {
      if (!["scheduled", "in_progress"].includes(String(s.status))) continue;
      const day = String(s.start_time).slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(s);
    }
    const heavy_day_recommendations: any[] = [];
    for (const [day, jobs] of Object.entries(byDay)) {
      if (jobs.length < 4) continue;
      // Stagger jobs that share the same morning hour
      const sorted = [...jobs].sort(
        (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );
      let staggerIndex = 0;
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const gap =
          new Date(cur.start_time).getTime() - new Date(prev.start_time).getTime();
        if (gap < 45 * 60000) {
          // less than 45 min apart — propose +1h * stagger
          staggerIndex++;
          const duration = endMs(cur) - new Date(cur.start_time).getTime();
          const newStart = new Date(cur.start_time);
          newStart.setHours(newStart.getHours() + staggerIndex);
          const newEnd = new Date(newStart.getTime() + duration);
          const v = vehMap.get(cur.vehicle_id);
          heavy_day_recommendations.push({
            kind: "heavy_day",
            day,
            schedule_id: cur.id,
            plate: v?.plate || null,
            job_description: cur.job_description,
            current_start: cur.start_time,
            current_end: cur.end_time,
            proposed_start: newStart.toISOString(),
            proposed_end: newEnd.toISOString(),
            hours_shifted: staggerIndex,
            summary: `${day}: stagger "${cur.job_description || "job"}" by +${staggerIndex}h (heavy day has ${jobs.length} jobs)`,
          });
        }
      }
      if (jobs.length >= 4 && !heavy_day_recommendations.some((r) => r.day === day)) {
        heavy_day_recommendations.push({
          kind: "heavy_day",
          day,
          schedule_id: null,
          plate: null,
          job_description: null,
          current_start: null,
          current_end: null,
          proposed_start: null,
          proposed_end: null,
          hours_shifted: 0,
          summary: `${day}: ${jobs.length} concurrent-day jobs — consider splitting loads across the next morning`,
          advisory_only: true,
        });
      }
    }

    // Locations
    const locations: Record<string, number> = {};
    for (const s of list) {
      const loc = (s.location || s.job_description || "Unspecified").split("·")[0].trim();
      locations[loc] = (locations[loc] || 0) + 1;
    }
    const topLocations = Object.entries(locations)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Fuel flags
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

    const optimisations: string[] = [];
    if (clash_recommendations.length) {
      optimisations.push(
        `${clash_recommendations.length} clash fix(es) ready — use Apply clash recommendations.`
      );
    }
    if (heavy_day_recommendations.filter((r) => r.schedule_id).length) {
      optimisations.push(
        `Heavy-day stagger plan ready — use Apply heavy-day recommendations.`
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
          clash_fixes: clash_recommendations.length,
          heavy_day_fixes: heavy_day_recommendations.filter((r) => r.schedule_id).length,
          top_locations: topLocations.slice(0, 5),
          fuel_flags: fuelFlags.slice(0, 5),
        };
        const prompt = `You are a South African fleet scheduler. In 3 short sentences: (1) clash situation, (2) heavy-day load, (3) one practical tip. Data: ${JSON.stringify(snap)}`;
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

    const enriched = list
      .map((s) => ({
        ...s,
        plate: vehMap.get(s.vehicle_id)?.plate || null,
        vehicle_fleet_id: vehMap.get(s.vehicle_id)?.vehicle_id || null,
        driver_name: s.driver_id ? drvMap.get(s.driver_id)?.name || null : null,
      }))
      .sort((a, b) => {
        const sr = statusRank(a.status) - statusRank(b.status);
        if (sr !== 0) return sr;
        return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
      });

    return NextResponse.json({
      success: true,
      schedules: enriched,
      clashes,
      clash_recommendations,
      heavy_day_recommendations,
      top_locations: topLocations,
      fuel_flags: fuelFlags,
      optimisations,
      ai_summary:
        ai_summary ||
        `${list.length} jobs · ${clashes.length} clash(es) · ${clash_recommendations.length} clash fix(es) · ${heavy_day_recommendations.filter((r) => r.schedule_id).length} heavy-day shift(s).`,
      counts: {
        total: list.length,
        clashes: clashes.length,
        fuel_flags: fuelFlags.length,
        clash_recommendations: clash_recommendations.length,
        heavy_day_recommendations: heavy_day_recommendations.filter((r) => r.schedule_id).length,
      },
    });
  } catch (e: any) {
    console.error("schedule-analytics error:", e);
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
