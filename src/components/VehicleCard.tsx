"use client";

import { kmToNextService, serviceProgress, daysUntil, formatDate } from "@/lib/utils";
import type { Vehicle } from "@/types";
import { Wrench, Car } from "lucide-react";

interface Props {
  vehicle: Vehicle;
  riskScore?: number;
  onSelect?: (v: Vehicle) => void;
  highlighted?: boolean;
  lightMode?: boolean;
}

export default function VehicleCard({
  vehicle,
  riskScore,
  onSelect,
  highlighted,
  lightMode = false,
}: Props) {
  const kmLeft = kmToNextService(vehicle);
  const progress = serviceProgress(vehicle);
  const coidaDays = daysUntil(vehicle.coida_expiry);
  const roadDays = daysUntil(vehicle.roadworthy_expiry);

  const statusColor = lightMode
    ? vehicle.status === "active"
      ? "bg-emerald-100 text-emerald-800 border-emerald-400"
      : vehicle.status === "maintenance"
      ? "bg-amber-100 text-amber-800 border-amber-400"
      : vehicle.status === "accident"
      ? "bg-red-100 text-red-800 border-red-400"
      : "bg-slate-100 text-slate-700 border-slate-300"
    : vehicle.status === "active"
    ? "bg-emerald-500/20 text-emerald-300 border-emerald-600"
    : vehicle.status === "maintenance"
    ? "bg-amber-500/20 text-amber-300 border-amber-600"
    : vehicle.status === "accident"
    ? "bg-red-500/20 text-red-300 border-red-600"
    : "bg-slate-500/20 text-slate-300 border-slate-600";

  const cardBg = lightMode
    ? highlighted
      ? "bg-white border-cyan-500 ring-2 ring-cyan-400/50 text-slate-900"
      : "bg-white border-slate-200 text-slate-900 hover:border-cyan-500"
    : highlighted
    ? "bg-slate-900 border-cyan-400 ring-2 ring-cyan-400/40 text-slate-100"
    : "bg-slate-900 border-slate-700 text-slate-100 hover:border-cyan-600";

  const muted = lightMode ? "text-slate-500" : "text-slate-400";
  const mutedSoft = lightMode ? "text-slate-400" : "text-slate-500";
  const barTrack = lightMode ? "bg-slate-200" : "bg-slate-800";
  const certOk = lightMode ? "border-slate-200 bg-slate-50" : "border-slate-700";
  const certWarn = lightMode ? "border-red-400 bg-red-50" : "border-red-600 bg-red-900/30";
  const warnText = lightMode ? "text-red-700 font-medium" : "text-red-300 font-medium";
  const kmWarn =
    kmLeft < 500
      ? lightMode
        ? "text-red-600"
        : "text-red-400"
      : kmLeft < 1000
      ? lightMode
        ? "text-amber-600"
        : "text-amber-400"
      : muted;

  return (
    <div
      onClick={() => onSelect?.(vehicle)}
      className={`border rounded-xl p-4 cursor-pointer transition ${cardBg}`}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="font-semibold text-lg flex items-center gap-2">
            <Car className="w-4 h-4 text-cyan-500" />
            {vehicle.plate}
          </h4>
          <p className={`text-sm ${muted}`}>
            {vehicle.vehicle_id} · {vehicle.make} {vehicle.model} ({vehicle.year})
          </p>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full border ${statusColor}`}>
          {vehicle.status}
        </span>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className={`flex items-center gap-1 ${muted}`}>
            <Wrench className="w-3 h-3" /> Service
          </span>
          <span className={kmWarn}>{Math.round(kmLeft)} km left</span>
        </div>
        <div className={`h-2 ${barTrack} rounded-full overflow-hidden`}>
          <div
            className={`h-full transition-all ${
              progress > 90 ? "bg-red-500" : progress > 70 ? "bg-amber-500" : "bg-cyan-500"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className={`text-xs ${mutedSoft} mt-1`}>
          Last: {formatDate(vehicle.last_service_date)} @ {vehicle.last_service_odometer ?? "—"} km
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div
          className={`p-2 rounded border ${
            coidaDays !== null && coidaDays <= 20 ? certWarn : certOk
          }`}
        >
          <p className={muted}>COIDA</p>
          <p className={coidaDays !== null && coidaDays <= 20 ? warnText : ""}>
            {formatDate(vehicle.coida_expiry)}
            {coidaDays !== null && (
              <span className="block text-[10px]">
                {coidaDays < 0 ? "EXPIRED" : `${coidaDays}d left`}
              </span>
            )}
          </p>
        </div>
        <div
          className={`p-2 rounded border ${
            roadDays !== null && roadDays <= 20 ? certWarn : certOk
          }`}
        >
          <p className={muted}>Roadworthy</p>
          <p className={roadDays !== null && roadDays <= 20 ? warnText : ""}>
            {formatDate(vehicle.roadworthy_expiry)}
            {roadDays !== null && (
              <span className="block text-[10px]">
                {roadDays < 0 ? "EXPIRED" : `${roadDays}d left`}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex justify-between items-center text-xs">
        <span className={muted}>
          Est. income: R{Number(vehicle.estimated_daily_income || 0).toLocaleString()}/day
        </span>
        {typeof riskScore === "number" && (
          <span
            className={`font-bold px-2 py-0.5 rounded text-white ${
              riskScore >= 70
                ? "bg-red-600"
                : riskScore >= 40
                ? "bg-amber-600"
                : "bg-emerald-700"
            }`}
          >
            Risk {riskScore}
          </span>
        )}
      </div>
    </div>
  );
}
