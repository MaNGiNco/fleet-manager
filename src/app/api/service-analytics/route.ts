import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { kmToNextService } from "@/lib/utils";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TEXT_MODEL = "openai/gpt-4o-mini";

function addDays(isoDate: Date, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Service analytics for a vehicle:
 * - km remaining from last service odo + interval
 * - scheduled route distance (from schedules job text / horizon)
 * - predicted next service date from daily km burn
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const vehicleId = body.vehicleId || body.vehicle_id;
    if (!vehicleId) {
      return NextResponse.json({ error: "vehicleId required" }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", vehicleId)
      .maybeSingle();

    if (error || !vehicle) {
      return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    }

    const kmLeft = kmToNextService(vehicle as any);
    const interval = vehicle.service_interval_km || 5000;
    const lastOdo = vehicle.last_service_odometer ?? null;
    const currentOdo = vehicle.current_odometer ?? 0;
    const usedSinceService =
      lastOdo != null ? Math.max(0, Number(currentOdo) - Number(lastOdo)) : null;

    // Schedules for this vehicle (next 14 days + recent)
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 14);

    const { data: schedules } = await supabase
      .from("schedules")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("start_time", { ascending: true })
      .limit(40);

    const upcoming = (schedules || []).filter((s) => {
      const t = new Date(s.start_time).getTime();
      return t >= now.getTime() - 24 * 3600 * 1000; // include last day
    });

    // Estimate route km from job_description numbers (e.g. "120km run") or default SA bakkie day
    let scheduledKmTotal = 0;
    let scheduledDays = 0;
    const routeNotes: string[] = [];
    for (const s of upcoming) {
      const desc = String(s.job_description || "");
      const kmMatch = desc.match(/(\d{2,4})\s*km/i);
      let legKm = kmMatch ? Number(kmMatch[1]) : 80; // default leg
      if (!Number.isFinite(legKm) || legKm <= 0) legKm = 80;
      scheduledKmTotal += legKm;
      scheduledDays += 1;
      routeNotes.push(
        `${new Date(s.start_time).toISOString().slice(0, 10)}: ${desc || "route"} (~${legKm} km)`
      );
    }

    const avgDailyKmFromSchedule =
      scheduledDays > 0 ? Math.round(scheduledKmTotal / Math.max(scheduledDays, 1)) : null;

    // Fallback daily burn: 120 km/day typical SA fleet LDV if no schedules
    const assumedDailyKm = avgDailyKmFromSchedule ?? 120;

    const daysUntilService =
      assumedDailyKm > 0 ? Math.max(0, Math.ceil(kmLeft / assumedDailyKm)) : null;
    const predictedServiceDate =
      daysUntilService != null ? addDays(now, daysUntilService) : null;

    // Optional AI narrative
    let aiNarrative: string | null = null;
    if (OPENROUTER_API_KEY) {
      try {
        const prompt = `You are a fleet service planner. In 2 short sentences, summarise service outlook for ${vehicle.make} ${vehicle.model} plate ${vehicle.plate}: current odo ${currentOdo} km, last service at ${lastOdo ?? "unknown"} km on ${vehicle.last_service_date ?? "unknown"}, interval ${interval} km, ${kmLeft} km remaining, ~${assumedDailyKm} km/day from schedules/assumption, predicted service date ${predictedServiceDate}. Be practical for a South African fleet manager.`;
        const res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-manager.vercel.app",
            "X-Title": "Fleet Manager Service Analytics",
          },
          body: JSON.stringify({
            model: TEXT_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 150,
            temperature: 0.3,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          aiNarrative = data.choices?.[0]?.message?.content?.trim() || null;
        }
      } catch {
        /* non-fatal */
      }
    }

    const urgency =
      kmLeft <= 200 ? "critical" : kmLeft <= 800 ? "high" : kmLeft <= 2000 ? "medium" : "low";

    const analytics = {
      vehicle_id: vehicle.id,
      plate: vehicle.plate,
      vehicle_fleet_id: vehicle.vehicle_id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      current_odometer: Number(currentOdo),
      last_service_odometer: lastOdo != null ? Number(lastOdo) : null,
      last_service_date: vehicle.last_service_date,
      service_interval_km: interval,
      km_since_last_service: usedSinceService,
      km_to_next_service: Math.round(kmLeft),
      service_progress_pct: Math.min(
        100,
        Math.round(((usedSinceService ?? 0) / interval) * 100)
      ),
      scheduled_routes_count: upcoming.length,
      scheduled_km_next_period: scheduledKmTotal,
      avg_daily_km_estimate: assumedDailyKm,
      daily_km_source: avgDailyKmFromSchedule != null ? "schedules" : "fleet_default_120",
      days_until_service_estimate: daysUntilService,
      predicted_next_service_date: predictedServiceDate,
      urgency,
      route_samples: routeNotes.slice(0, 5),
      summary:
        aiNarrative ||
        `${vehicle.plate}: ${Math.round(kmLeft)} km to next service (interval ${interval} km). ` +
          `At ~${assumedDailyKm} km/day, expect service around ${predictedServiceDate || "n/a"}.`,
      recommendations: [
        kmLeft <= 500
          ? "Book service soon — under 500 km remaining."
          : "Monitor odometer after each route; rescan service job cards to reset interval.",
        avgDailyKmFromSchedule != null
          ? `Scheduled work implies ~${assumedDailyKm} km/day over the next routes.`
          : "Add route distances (e.g. '150km delivery') on schedules to refine the service date prediction.",
        vehicle.last_service_date
          ? `Last service logged ${vehicle.last_service_date} at ${lastOdo ?? "—"} km.`
          : "No last service date on file — scan a service job card to baseline.",
      ],
    };

    return NextResponse.json({ success: true, analytics });
  } catch (e: any) {
    console.error("service-analytics error:", e);
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
