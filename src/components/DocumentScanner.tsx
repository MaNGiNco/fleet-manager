"use client";

import { useState, useRef } from "react";
import { Camera, Upload, Loader2, CheckCircle, AlertCircle } from "lucide-react";

interface ScanResult {
  extracted: any;
  matchedVehicle: any;
  scanId?: string;
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

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Camera className="w-5 h-5 text-cyan-400" />
        Document Scanner (COIDA / Roadworthy)
      </h3>
      <p className="text-sm text-slate-400">
        Take a photo or upload a certificate. AI extracts details and matches the vehicle.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium transition"
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
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {result && (
        <div className="bg-slate-800 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-emerald-400 font-medium">
            <CheckCircle className="w-4 h-4" />
            Extraction complete
          </div>
          <div className="grid grid-cols-2 gap-2 text-slate-300">
            <span>Type:</span>
            <span className="font-mono">{result.extracted?.document_type || "—"}</span>
            <span>Plate:</span>
            <span className="font-mono">{result.extracted?.vehicle_plate || "—"}</span>
            <span>Vehicle ID:</span>
            <span className="font-mono">{result.extracted?.vehicle_id || "—"}</span>
            <span>Holder:</span>
            <span>{result.extracted?.holder_name || "—"}</span>
            <span>Issue:</span>
            <span>{result.extracted?.issue_date || "—"}</span>
            <span>Expiry:</span>
            <span className={result.extracted?.expiry_date ? "text-amber-300" : ""}>
              {result.extracted?.expiry_date || "—"}
            </span>
          </div>
          {result.matchedVehicle ? (
            <div className="mt-3 p-3 bg-emerald-900/40 border border-emerald-700 rounded-lg">
              <p className="text-emerald-300 font-medium">Matched Vehicle</p>
              <p>
                {result.matchedVehicle.plate} · {result.matchedVehicle.vehicle_id} ·{" "}
                {result.matchedVehicle.make} {result.matchedVehicle.model}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Certificate dates updated where applicable.
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
