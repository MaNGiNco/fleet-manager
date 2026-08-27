"use client";

import { useState, useRef } from "react";
import { Camera, Upload, Loader2, CheckCircle, AlertCircle, Fuel } from "lucide-react";

interface ScanResult {
  extracted: any;
  matchedVehicle: any;
  scanId?: string;
  isFuelSlip?: boolean;
  researched_avg_l_per_100km?: number | null;
  isServiceRecord?: boolean;
  isSchedule?: boolean;
  scheduleUpdate?: {
    created: any;
    clashes: any[];
    vehicle_plate?: string;
    fleet_id?: string;
    driver_name?: string | null;
    driver_id?: string | null;
    job_type?: string | null;
    location?: string | null;
    start_time?: string;
    end_time?: string | null;
    status?: string;
    has_clashes?: boolean;
  } | null;
  serviceUpdate?: {
    previous_service_odometer: number | null;
    previous_service_date: string | null;
    previous_interval_km: number;
    new_service_odometer: number | null;
    service_date: string;
    service_reason: string | null;
    researched_interval_km: number;
    interval_note: string;
    km_to_next_service: number;
    plate?: string;
    vehicle_id?: string;
    fleet_id?: string;
  } | null;
  priceVerification?: {
    slip_liters: number | null;
    cost_zar: number | null;
    researched_price_per_litre: number;
    researched_price_label: string;
    price_source: string;
    implied_price_per_litre: number | null;
    expected_liters_from_cost: number | null;
    liters_delta: number | null;
    liters_delta_pct: number | null;
    match_status: "match" | "under_liters" | "over_liters" | "insufficient_data";
    message: string;
    fraud_flagged?: boolean;
    fraud_flag_id?: string | null;
    severity?: string;
    voice_note?: {
      script: string;
      driver_name: string;
      driver_id: string | null;
      driver_phone: string | null;
      voice: string;
      status: string;
    };
    price_board?: {
      petrol_93: number;
      petrol_95: number;
      diesel_500ppm: number;
      diesel_50ppm: number;
      region: string;
      effective: string;
    };
  } | null;
}

export default function DocumentScanner({ onMatch }: { onMatch?: (v: any) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fraudActionMsg, setFraudActionMsg] = useState<string | null>(null);
  const [fraudBusy, setFraudBusy] = useState(false);
  const [voiceAcked, setVoiceAcked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speakScript = (script: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(script);
    u.rate = 0.92;
    u.pitch = 1.05;
    u.lang = "en-ZA";
    const voices = window.speechSynthesis.getVoices();
    const female =
      voices.find((v) => /female|woman|zira|samantha|karen|moira|tessa|google uk english female/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith("en") && /female/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith("en"));
    if (female) u.voice = female;
    window.speechSynthesis.speak(u);
  };

  const sendVoiceNote = async () => {
    const pv = result?.priceVerification;
    if (!pv?.fraud_flag_id || !pv.voice_note) return;
    setFraudBusy(true);
    setFraudActionMsg(null);
    try {
      // Play calm female sample + browser TTS with driver name
      const audio = new Audio("/voice-notes/fraud-meeting-request-sample.mp3");
      audioRef.current = audio;
      try {
        await audio.play();
      } catch {
        speakScript(pv.voice_note.script);
      }
      // Prefer named script via TTS after a short delay so sample + personalised both work
      window.setTimeout(() => speakScript(pv.voice_note!.script), 400);

      const res = await fetch("/api/fraud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_voice", fraudFlagId: pv.fraud_flag_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark voice sent");
      setFraudActionMsg(
        `Voice note sent to ${pv.voice_note.driver_name}` +
          (pv.voice_note.driver_phone ? ` (${pv.voice_note.driver_phone})` : "") +
          ". Awaiting driver confirmation."
      );
      setResult({
        ...result!,
        priceVerification: {
          ...pv,
          voice_note: { ...pv.voice_note, status: "voice_sent" },
        },
      });
    } catch (e: any) {
      setFraudActionMsg(e.message || "Could not send voice note");
    } finally {
      setFraudBusy(false);
    }
  };

  const confirmDriverAck = async () => {
    const pv = result?.priceVerification;
    if (!pv?.fraud_flag_id) return;
    setFraudBusy(true);
    try {
      const res = await fetch("/api/fraud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "acknowledge",
          fraudFlagId: pv.fraud_flag_id,
          response: "Driver confirmed receipt of the meeting request voice note",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ack failed");
      setVoiceAcked(true);
      setFraudActionMsg("Driver confirmed they received the voice note.");
    } catch (e: any) {
      setFraudActionMsg(e.message || "Could not record acknowledgment");
    } finally {
      setFraudBusy(false);
    }
  };


  const handleFile = async (file: File) => {
    setError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setPreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      const mime = file.type || "image/jpeg";
      await runScan(base64, mime);
    };
    reader.readAsDataURL(file);
  };

  const runScan = async (base64: string, mimeType: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setResult(data);
      if (data.matchedVehicle && onMatch) onMatch(data.matchedVehicle);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isFuel = result?.isFuelSlip || String(result?.extracted?.document_type || "").toLowerCase().includes("fuel");
  const isService =
    result?.isServiceRecord ||
    String(result?.extracted?.document_type || "").toLowerCase().includes("service");
  const isSchedule =
    result?.isSchedule ||
    String(result?.extracted?.document_type || "").toLowerCase().includes("schedule") ||
    String(result?.extracted?.document_type || "").toLowerCase().includes("dispatch") ||
    String(result?.extracted?.document_type || "").toLowerCase().includes("delivery");

  return (
    <div className="bg-slate-900 text-slate-100 border border-slate-700 rounded-xl p-5 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-100">
        <Camera className="w-5 h-5 text-cyan-400" />
        Document, Fuel, Service &amp; Schedule Scanner
      </h3>
      <p className="text-sm text-slate-400">
        Photo of COIDA / Roadworthy, <strong>fuel slips</strong>, or <strong>service / schedule / dispatch sheets</strong>. AI extracts plate,
        litres, cost, odometer and tank level, then updates the matched vehicle.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition w-full sm:w-auto"
        >
          <Upload className="w-4 h-4" />
          Upload / Capture Photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {preview && (
        <div className="relative max-w-xs">
          <img src={preview} alt="Preview" className="rounded-lg border border-slate-600 max-h-48 object-contain" />
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-cyan-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Extracting with Vision AI…
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setResult(null);
              setPreview(null);
              fileRef.current?.click();
            }}
            className="min-h-[44px] px-4 rounded-lg bg-red-600/20 border border-red-600/50 text-red-300 text-sm font-medium"
          >
            Retry scan
          </button>
        </div>
      )}

      {result && (
        <div className="bg-slate-800 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-emerald-400 font-medium">
            <CheckCircle className="w-4 h-4" />
            Extraction complete
            {isFuel && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-cyan-900/60 border border-cyan-700 text-cyan-300">
                <Fuel className="w-3 h-3" /> Fuel slip
              </span>
            )}
            {isService && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-900/60 border border-amber-700 text-amber-300">
                Service record
              </span>
            )}
            {isSchedule && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-900/60 border border-violet-700 text-violet-300">
                Schedule
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-300">
            <span>Type:</span>
            <span className="font-mono">{result.extracted?.document_type || "—"}</span>
            <span>Plate:</span>
            <span className="font-mono">{result.extracted?.vehicle_plate || "—"}</span>
            <span>Vehicle ID:</span>
            <span className="font-mono">{result.extracted?.vehicle_id || result.extracted?.fleet_id || "—"}</span>
            {isService && (
              <>
                <span>Fleet ID:</span>
                <span className="font-mono">{result.extracted?.fleet_id || result.extracted?.vehicle_id || "—"}</span>
                <span>Odometer:</span>
                <span className="font-mono text-amber-300">
                  {result.extracted?.odometer != null
                    ? `${Number(result.extracted.odometer).toLocaleString()} km`
                    : "—"}
                </span>
                <span>Service reason:</span>
                <span>{result.extracted?.service_reason || "—"}</span>
                <span>Service date:</span>
                <span>{result.extracted?.service_date || result.extracted?.issue_date || "—"}</span>
              </>
            )}
            {isSchedule && (
              <>
                <span>Job type:</span>
                <span>{result.extracted?.job_type || "—"}</span>
                <span>Date / time:</span>
                <span className="font-mono">
                  {result.extracted?.job_date || "—"} {result.extracted?.job_time || ""}
                </span>
                <span>Driver:</span>
                <span>{result.extracted?.driver_name || result.extracted?.driver_id || "—"}</span>
                <span>Location:</span>
                <span>{result.extracted?.location || "—"}</span>
                <span>Status:</span>
                <span className="capitalize">{result.extracted?.delivery_status || "—"}</span>
              </>
            )}
            {!isFuel && !isService && !isSchedule && (
              <>
                <span>Holder:</span>
                <span>{result.extracted?.holder_name || "—"}</span>
                <span>Issue:</span>
                <span>{result.extracted?.issue_date || "—"}</span>
                <span>Expiry:</span>
                <span className={result.extracted?.expiry_date ? "text-amber-300" : ""}>
                  {result.extracted?.expiry_date || "—"}
                </span>
              </>
            )}
            {isFuel && (
              <>
                <span>Litres:</span>
                <span className="font-mono text-cyan-300">
                  {result.extracted?.liters != null ? `${result.extracted.liters} L` : "—"}
                </span>
                <span>Cost:</span>
                <span className="font-mono">
                  {result.extracted?.cost_zar != null
                    ? `R ${Number(result.extracted.cost_zar).toLocaleString()}`
                    : "—"}
                </span>
                <span>Odometer:</span>
                <span className="font-mono">{result.extracted?.odometer ?? "—"}</span>
                <span>Tank after fill:</span>
                <span className="font-mono text-cyan-300">
                  {result.extracted?.fuel_level_pct != null
                    ? `${result.extracted.fuel_level_pct}%`
                    : "—"}
                </span>
                <span>Station:</span>
                <span>{result.extracted?.station_name || "—"}</span>
                <span>Fuel type:</span>
                <span className="capitalize">{result.extracted?.fuel_type || "—"}</span>
                {result.researched_avg_l_per_100km != null && (
                  <>
                    <span>AI model avg:</span>
                    <span className="font-mono text-emerald-300">
                      {result.researched_avg_l_per_100km} L/100km
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          {isFuel && result.priceVerification && (
            <div
              className={`mt-3 p-3 rounded-lg border text-xs space-y-1.5 ${
                result.priceVerification.match_status === "match"
                  ? "bg-emerald-900/30 border-emerald-700"
                  : result.priceVerification.match_status === "insufficient_data"
                  ? "bg-slate-800/80 border-slate-600"
                  : "bg-amber-900/30 border-amber-700"
              }`}
            >
              <p className="font-medium text-slate-100 flex items-center gap-1.5">
                <Fuel className="w-3.5 h-3.5 text-cyan-400" />
                Price check (litres vs spend)
              </p>
              <p
                className={
                  result.priceVerification.match_status === "match"
                    ? "text-emerald-300"
                    : result.priceVerification.match_status === "insufficient_data"
                    ? "text-slate-400"
                    : "text-amber-300"
                }
              >
                {result.priceVerification.message}
              </p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-300 pt-1">
                <span>Researched price</span>
                <span className="font-mono text-cyan-300">
                  R{result.priceVerification.researched_price_per_litre}/L
                  <span className="text-slate-500 block text-[10px]">
                    {result.priceVerification.researched_price_label}
                  </span>
                </span>
                <span>Implied from slip</span>
                <span className="font-mono">
                  {result.priceVerification.implied_price_per_litre != null
                    ? `R${result.priceVerification.implied_price_per_litre}/L`
                    : "—"}
                </span>
                <span>Expected litres @ price</span>
                <span className="font-mono">
                  {result.priceVerification.expected_liters_from_cost != null
                    ? `${result.priceVerification.expected_liters_from_cost} L`
                    : "—"}
                </span>
                <span>Slip litres</span>
                <span className="font-mono">
                  {result.priceVerification.slip_liters != null
                    ? `${result.priceVerification.slip_liters} L`
                    : "—"}
                </span>
                <span>Delta</span>
                <span
                  className={`font-mono ${
                    result.priceVerification.match_status === "match"
                      ? "text-emerald-400"
                      : result.priceVerification.match_status === "insufficient_data"
                      ? ""
                      : "text-amber-400"
                  }`}
                >
                  {result.priceVerification.liters_delta != null
                    ? `${result.priceVerification.liters_delta > 0 ? "+" : ""}${result.priceVerification.liters_delta} L (${result.priceVerification.liters_delta_pct}%)`
                    : "—"}
                </span>
              </div>
              {result.priceVerification.price_board && (
                <p className="text-[10px] text-slate-500 pt-1">
                  Board ({result.priceVerification.price_board.region}, eff.{" "}
                  {result.priceVerification.price_board.effective}): 93 R
                  {result.priceVerification.price_board.petrol_93} · 95 R
                  {result.priceVerification.price_board.petrol_95} · diesel 500ppm R
                  {result.priceVerification.price_board.diesel_500ppm} · 50ppm R
                  {result.priceVerification.price_board.diesel_50ppm}
                  {" · "}
                  {result.priceVerification.price_source}
                </p>
              )}
            </div>
          )}

          {isFuel && result.priceVerification?.fraud_flagged && (
            <div className="mt-3 p-3 rounded-lg border border-red-600/60 bg-red-950/40 space-y-2 text-xs">
              <p className="font-semibold text-red-300 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" />
                Fraud flag — litres vs spend mismatch
                {result.priceVerification.severity && (
                  <span className="ml-auto uppercase tracking-wide text-[10px] px-1.5 py-0.5 rounded bg-red-800/80">
                    {result.priceVerification.severity}
                  </span>
                )}
              </p>
              <p className="text-red-200/90">{result.priceVerification.message}</p>
              {result.priceVerification.voice_note && (
                <div className="bg-slate-900/60 rounded-lg p-2.5 space-y-2 border border-slate-700">
                  <p className="text-slate-300 font-medium">Voice note to driver</p>
                  <p className="text-slate-400 italic">
                    &ldquo;{result.priceVerification.voice_note.script}&rdquo;
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Voice: Celeste — confident, calm, relaxed female · Driver:{" "}
                    {result.priceVerification.voice_note.driver_name}
                    {result.priceVerification.voice_note.driver_phone
                      ? ` · ${result.priceVerification.voice_note.driver_phone}`
                      : ""}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      disabled={fraudBusy || result.priceVerification.voice_note.status === "voice_sent"}
                      onClick={sendVoiceNote}
                      className="min-h-[40px] px-3 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium"
                    >
                      {result.priceVerification.voice_note.status === "voice_sent"
                        ? "Voice note sent"
                        : fraudBusy
                        ? "Sending…"
                        : "Send voice note to driver"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        fraudBusy ||
                        voiceAcked ||
                        result.priceVerification.voice_note.status !== "voice_sent"
                      }
                      onClick={confirmDriverAck}
                      className="min-h-[40px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-medium"
                    >
                      {voiceAcked ? "Driver confirmed receipt" : "Confirm driver received note"}
                    </button>
                  </div>
                  {fraudActionMsg && (
                    <p className="text-cyan-300 text-[11px] pt-1">{fraudActionMsg}</p>
                  )}
                </div>
              )}
            </div>
          )}


          {isService && result.serviceUpdate && (
            <div className="mt-3 p-3 rounded-lg border border-amber-700 bg-amber-950/30 text-xs space-y-1.5">
              <p className="font-medium text-amber-300">Service baseline updated</p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-300">
                <span>Previous service odo</span>
                <span className="font-mono">
                  {result.serviceUpdate.previous_service_odometer != null
                    ? `${Number(result.serviceUpdate.previous_service_odometer).toLocaleString()} km`
                    : "—"}
                </span>
                <span>New service odo</span>
                <span className="font-mono text-amber-300">
                  {result.serviceUpdate.new_service_odometer != null
                    ? `${Number(result.serviceUpdate.new_service_odometer).toLocaleString()} km`
                    : "—"}
                </span>
                <span>AI interval (make/model)</span>
                <span className="font-mono text-cyan-300">
                  {result.serviceUpdate.researched_interval_km.toLocaleString()} km
                </span>
                <span>Km to next service</span>
                <span className="font-mono">
                  {result.serviceUpdate.km_to_next_service.toLocaleString()} km
                </span>
                <span>Reason</span>
                <span>{result.serviceUpdate.service_reason || "—"}</span>
              </div>
              <p className="text-[10px] text-slate-500">{result.serviceUpdate.interval_note}</p>
            </div>
          )}


          {isSchedule && result.scheduleUpdate && (
            <div
              className={`mt-3 p-3 rounded-lg border text-xs space-y-1.5 ${
                result.scheduleUpdate.has_clashes
                  ? "border-red-600/60 bg-red-950/40"
                  : "border-violet-700 bg-violet-950/30"
              }`}
            >
              <p className={`font-medium ${result.scheduleUpdate.has_clashes ? "text-red-300" : "text-violet-300"}`}>
                {result.scheduleUpdate.created
                  ? "Schedule saved to database"
                  : "Schedule extracted (vehicle not matched — not saved)"}
              </p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-slate-300">
                <span>Vehicle</span>
                <span className="font-mono">{result.scheduleUpdate.vehicle_plate || "—"}</span>
                <span>Fleet ID</span>
                <span className="font-mono">{result.scheduleUpdate.fleet_id || "—"}</span>
                <span>Driver</span>
                <span>{result.scheduleUpdate.driver_name || "—"}</span>
                <span>Window</span>
                <span className="font-mono text-[10px]">
                  {result.scheduleUpdate.start_time
                    ? new Date(result.scheduleUpdate.start_time).toLocaleString("en-ZA")
                    : "—"}
                </span>
                <span>Location</span>
                <span>{result.scheduleUpdate.location || "—"}</span>
              </div>
              {result.scheduleUpdate.has_clashes && (
                <div className="mt-2 space-y-1">
                  <p className="text-red-300 font-medium">Clashes detected</p>
                  {(result.scheduleUpdate.clashes || []).map((c: any, i: number) => (
                    <p key={i} className="text-red-200/90">
                      · {c.message}
                      {c.existing_job ? ` (${c.existing_job})` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {result.matchedVehicle ? (
            <div className="mt-3 p-3 bg-emerald-900/40 border border-emerald-700 rounded-lg">
              <p className="text-emerald-300 font-medium">Matched Vehicle</p>
              <p>
                {result.matchedVehicle.plate} · {result.matchedVehicle.vehicle_id} ·{" "}
                {result.matchedVehicle.make} {result.matchedVehicle.model}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {isFuel
                  ? `Fuel level${
                      result.matchedVehicle.current_fuel_level_pct != null
                        ? ` now ${result.matchedVehicle.current_fuel_level_pct}%`
                        : ""
                    }, refuel log and bulk reserve updated.`
                  : isService
                  ? `Service logged. Interval set to ${result.matchedVehicle.service_interval_km || "—"} km; km-to-service reset from current odometer.`
                  : isSchedule
                  ? result.scheduleUpdate?.has_clashes
                    ? "Schedule saved but clashes were flagged — review before dispatch."
                    : "Schedule saved for this vehicle/driver."
                  : "Certificate dates updated where applicable."}
              </p>
            </div>
          ) : (
            <p className="text-amber-400 text-xs mt-2">No matching vehicle found in fleet database.</p>
          )}
        </div>
      )}
    </div>
  );
}
