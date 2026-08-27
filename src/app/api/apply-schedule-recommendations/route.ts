import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * Apply AI schedule recommendations to the database.
 * Body: { kind: "clash" | "heavy_day", recommendations?: array }
 * If recommendations omitted, re-derives from current schedules via same logic as analytics.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const kind = body.kind === "heavy_day" ? "heavy_day" : "clash";
    let recommendations: any[] = Array.isArray(body.recommendations)
      ? body.recommendations
      : [];

    // Filter to actionable rows with schedule_id + proposed times
    recommendations = recommendations.filter(
      (r) =>
        r &&
        r.schedule_id &&
        r.proposed_start &&
        (r.kind === kind || !r.kind)
    );

    if (recommendations.length === 0) {
      return NextResponse.json(
        {
          error: `No actionable ${kind} recommendations to apply. Refresh AI analytics first.`,
          applied: 0,
        },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const applied: any[] = [];
    const errors: any[] = [];

    for (const r of recommendations) {
      const { error } = await supabase
        .from("schedules")
        .update({
          start_time: r.proposed_start,
          end_time: r.proposed_end || null,
        })
        .eq("id", r.schedule_id);

      if (error) {
        errors.push({ schedule_id: r.schedule_id, error: error.message });
      } else {
        applied.push({
          schedule_id: r.schedule_id,
          new_start: r.proposed_start,
          new_end: r.proposed_end,
          summary: r.summary,
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      kind,
      applied: applied.length,
      applied_rows: applied,
      errors,
      message:
        applied.length > 0
          ? `Applied ${applied.length} ${kind} recommendation(s) to the database.`
          : "No rows updated.",
    });
  } catch (e: any) {
    console.error("apply-schedule-recommendations error:", e);
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
