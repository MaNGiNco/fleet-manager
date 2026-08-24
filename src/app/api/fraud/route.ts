import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * Fraud flag management:
 * GET  ?status=open|voice_sent|...  — list flags
 * POST { action: "send_voice", fraudFlagId } — mark voice note sent
 * POST { action: "acknowledge", fraudFlagId, response? } — driver confirmed receipt
 * POST { action: "resolve" | "dismiss", fraudFlagId, notes? }
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const status = req.nextUrl.searchParams.get("status");
    let q = supabase
      .from("fraud_flags")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message, flags: [] }, { status: 200 });
    }
    return NextResponse.json({ success: true, flags: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error", flags: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action, fraudFlagId, response, notes } = body;
    if (!fraudFlagId || !action) {
      return NextResponse.json(
        { error: "fraudFlagId and action required" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const { data: flag, error: fetchErr } = await supabase
      .from("fraud_flags")
      .select("*")
      .eq("id", fraudFlagId)
      .maybeSingle();

    if (fetchErr || !flag) {
      return NextResponse.json({ error: "Fraud flag not found" }, { status: 404 });
    }

    if (action === "send_voice") {
      const { data: updated, error } = await supabase
        .from("fraud_flags")
        .update({
          status: "voice_sent",
          voice_note_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", fraudFlagId)
        .select("*")
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        flag: updated,
        message: "Voice note marked as sent to driver. Awaiting acknowledgment.",
        voice_note: {
          script: flag.voice_note_script,
          voice: "celeste",
          instruction:
            "Play the calm female voice note to the driver (or share the audio). Confirm delivery when they respond.",
        },
      });
    }

    if (action === "acknowledge") {
      const { data: updated, error } = await supabase
        .from("fraud_flags")
        .update({
          status: "acknowledged",
          driver_acknowledged_at: new Date().toISOString(),
          driver_response: response || "Driver confirmed receipt of voice note",
          updated_at: new Date().toISOString(),
        })
        .eq("id", fraudFlagId)
        .select("*")
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        flag: updated,
        message: "Driver acknowledgment recorded.",
      });
    }

    if (action === "resolve" || action === "dismiss") {
      const { data: updated, error } = await supabase
        .from("fraud_flags")
        .update({
          status: action === "resolve" ? "resolved" : "dismissed",
          notes: notes || flag.notes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", fraudFlagId)
        .select("*")
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, flag: updated });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
