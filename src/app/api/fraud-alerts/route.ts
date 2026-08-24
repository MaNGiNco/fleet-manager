import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

function buildVoiceScript(driverName: string): string {
  const name = (driverName || "there").trim() || "there";
  return `Hi ${name}, the manager is kindly requesting an urgent meeting with you within the next 24 hours. May I note your response?`;
}

/** GET — list open fraud alerts (optional ?status=open) */
export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const status = req.nextUrl.searchParams.get("status");
    let q = supabase.from("fraud_alerts").select("*").order("created_at", { ascending: false }).limit(50);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) {
      // Demo fallback when table missing
      return NextResponse.json({ success: true, alerts: [], demo: true, error: error.message });
    }
    return NextResponse.json({ success: true, alerts: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

/**
 * POST actions:
 * - create (from scan) body: { action: "create", ...fields }
 * - send_voice { action: "send_voice", alertId }
 * - confirm_received { action: "confirm_received", alertId, driverResponse? }
 * - resolve { action: "resolve", alertId, status? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action || "create";
    const supabase = createServerClient();

    if (action === "create") {
      const driverName = body.driver_name || "Driver";
      const voice_script = body.voice_script || buildVoiceScript(driverName);
      const row = {
        vehicle_id: body.vehicle_id || null,
        driver_id: body.driver_id || null,
        document_scan_id: body.document_scan_id || null,
        fuel_transaction_id: body.fuel_transaction_id || null,
        plate: body.plate || null,
        driver_name: driverName,
        driver_phone: body.driver_phone || null,
        match_status: body.match_status || null,
        slip_liters: body.slip_liters ?? null,
        expected_liters: body.expected_liters ?? null,
        cost_zar: body.cost_zar ?? null,
        researched_price_per_litre: body.researched_price_per_litre ?? null,
        liters_delta: body.liters_delta ?? null,
        liters_delta_pct: body.liters_delta_pct ?? null,
        reason: body.reason || null,
        voice_script,
        voice_note_status: "pending",
        status: "open",
      };
      const { data, error } = await supabase.from("fraud_alerts").insert(row).select("*").single();
      if (error) {
        // Return synthetic alert for demo mode without DB
        return NextResponse.json({
          success: true,
          alert: {
            id: `demo-${Date.now()}`,
            ...row,
            voice_sent_at: null,
            voice_acknowledged_at: null,
            driver_response: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          demo: true,
          dbError: error.message,
        });
      }
      return NextResponse.json({ success: true, alert: data });
    }

    if (action === "send_voice") {
      const alertId = body.alertId || body.alert_id;
      if (!alertId) return NextResponse.json({ error: "alertId required" }, { status: 400 });

      const now = new Date().toISOString();
      if (String(alertId).startsWith("demo-")) {
        return NextResponse.json({
          success: true,
          alert: {
            id: alertId,
            voice_note_status: "sent",
            voice_sent_at: now,
            status: "open",
          },
          demo: true,
          message: "Voice note marked as sent to driver (demo).",
        });
      }

      const { data, error } = await supabase
        .from("fraud_alerts")
        .update({
          voice_note_status: "sent",
          voice_sent_at: now,
          updated_at: now,
        })
        .eq("id", alertId)
        .select("*")
        .single();

      if (error) {
        return NextResponse.json({
          success: true,
          alert: { id: alertId, voice_note_status: "sent", voice_sent_at: now },
          demo: true,
          dbError: error.message,
        });
      }
      return NextResponse.json({
        success: true,
        alert: data,
        message: "Voice note marked as sent. Confirm delivery when the driver acknowledges.",
      });
    }

    if (action === "confirm_received") {
      const alertId = body.alertId || body.alert_id;
      if (!alertId) return NextResponse.json({ error: "alertId required" }, { status: 400 });
      const now = new Date().toISOString();
      const driver_response =
        body.driverResponse ||
        body.driver_response ||
        "Driver confirmed receipt of the voice note.";

      if (String(alertId).startsWith("demo-")) {
        return NextResponse.json({
          success: true,
          alert: {
            id: alertId,
            voice_note_status: "acknowledged",
            voice_acknowledged_at: now,
            driver_response,
            status: "meeting_scheduled",
          },
          demo: true,
        });
      }

      const { data, error } = await supabase
        .from("fraud_alerts")
        .update({
          voice_note_status: "acknowledged",
          voice_acknowledged_at: now,
          driver_response,
          status: "meeting_scheduled",
          updated_at: now,
        })
        .eq("id", alertId)
        .select("*")
        .single();

      if (error) {
        return NextResponse.json({
          success: true,
          alert: {
            id: alertId,
            voice_note_status: "acknowledged",
            voice_acknowledged_at: now,
            driver_response,
            status: "meeting_scheduled",
          },
          demo: true,
          dbError: error.message,
        });
      }
      return NextResponse.json({ success: true, alert: data });
    }

    if (action === "resolve") {
      const alertId = body.alertId || body.alert_id;
      const status = body.status || "resolved";
      if (!alertId) return NextResponse.json({ error: "alertId required" }, { status: 400 });
      const now = new Date().toISOString();
      if (String(alertId).startsWith("demo-")) {
        return NextResponse.json({ success: true, alert: { id: alertId, status }, demo: true });
      }
      const { data, error } = await supabase
        .from("fraud_alerts")
        .update({ status, updated_at: now })
        .eq("id", alertId)
        .select("*")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, alert: data });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("fraud-alerts error:", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
