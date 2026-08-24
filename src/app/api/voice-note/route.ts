import { NextRequest, NextResponse } from "next/server";

/**
 * Returns the voice-note script for a fraud flag and metadata for TTS playback.
 * Actual MP3 synthesis in production can use an external TTS provider;
 * the UI uses Web Speech API (female voice preference) as a reliable fallback
 * and can play the bundled sample for demos.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const driverName =
      typeof body.driverName === "string" && body.driverName.trim()
        ? body.driverName.trim()
        : "Driver";

    const script = `Hi ${driverName}, the manager is kindly requesting an urgent meeting with you within the next 24hrs. May I note your response?`;

    return NextResponse.json({
      success: true,
      script,
      voice: "celeste",
      voice_description: "Confident, calm, relaxed female voice",
      sample_audio_url: "/voice-notes/fraud-meeting-request-sample.mp3",
      tts_hint: {
        preferredGender: "female",
        rate: 0.92,
        pitch: 1.0,
        lang: "en-ZA",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
