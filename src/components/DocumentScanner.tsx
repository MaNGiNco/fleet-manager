"use client";

import { useState, useRef } from "react";
import { Camera, Upload, Loader2, CheckCircle, AlertCircle, Fuel } from "lucide-react";

interface ScanResult {
  extracted: any;
  matchedVehicle: any;
  scanId?: string;
  isFuelSlip?: boolean;
  researched_avg_l_per_100km?: number | null;
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

  return (
    <div className="bg-slate-900 text-slate-100 border border-slate-700 rounded-xl p-5 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2 text-slate-100">
        <Camera className="w-5 h-5 text-cyan-400" />
        Document &amp; Fuel Slip Scanner
      </h3>
      <p className="text-sm text-slate-400">
        Photo of COIDA / Roadworthy certificates <strong>or fuel slips</strong>. AI extracts plate,
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
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-300">
            <span>Type:</span>
            <span className="font-mono">{result.extracted?.document_type || "—"}</span>
            <span>Plate:</span>
            <span className="font-mono">{result.extracted?.vehicle_plate || "—"}</span>
            <span>Vehicle ID:</span>
            <span className="font-mono">{result.extracted?.vehicle_id || "—"}</span>
            {!isFuel && (
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
          {result.matchedVehicle ? (
            <div className="mt-3 p-3 bg-emerald-900/40 border border-emerald-700 rounded-lg">
              <p className="text-emerald-300 font-medium">Matched Vehicle</p>
              <p>
                {result.matchedVehicle.plate} · {result.matchedVehicle.vehicle_id} ·{" "}
                {result.matchedVehicle.make} {result.matchedVehicle.model}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {isFuel
                  ? "Fuel level, refuel log and bulk reserve updated where data was readable."
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
