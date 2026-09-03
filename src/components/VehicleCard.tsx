"use client";

import { kmToNextService, serviceProgress, daysUntil, formatDate } from "@/lib/utils";
import type { Vehicle } from "@/types";
import { Wrench, Car, Gauge, CalendarClock } from "lucide-react";

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
  const roadDays = daysUntil(vehicle.roadworthy_expiry);

  const statusStyles = lightMode
    ? {
        active: "bg-emerald-50 text-emerald-700 border-emerald-200",
        maintenance: "bg-amber-50 text-amber-800 border-amber-200",
        accident: "bg-rose-50 text-rose-700 border-rose-200",
        default: "bg-slate-100 text-slate-600 border-slate-200",
      }
    : {
        active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
        maintenance: "bg-amber-500/15 text-amber-300 border-amber-500/40",
        accident: "bg-rose-500/15 text-rose-300 border-rose-500/40",
        default: "bg-slate-500/15 text-slate-400 border-slate-500/40",
      };

  const statusKey =
    vehicle.status === "active"
      ? "active"
      : vehicle.status === "maintenance"
      ? "maintenance"
      : vehicle.status === "accident"
      ? "accident"
      : "default";

  const cardBase = lightMode
    ? highlighted
      ? "bg-white border-cyan-400 ring-2 ring-cyan-400/40 shadow-lg shadow-cyan-500/10 text-slate-900"
      : "bg-white border-slate-200 text-slate-900 hover:border-cyan-400/70 hover:shadow-md"
    : highlighted
    ? "bg-[#121A2B] border-cyan-400/70 ring-2 ring-cyan-400/30 shadow-glow-cyan text-slate-100"
    : "bg-[#0D1320] border-[#1E2A3F] text-slate-100 hover:border-cyan-500/40 hover:shadow-ops";

  const muted = lightMode ? "text-slate-500" : "text-slate-400";
  const mutedSoft = lightMode ? "text-slate-400" : "text-slate-500";
  const barTrack = lightMode ? "bg-slate-200" : "bg-slate-800/90";
  const certOk = lightMode ? "border-slate-200 bg-slate-50" : "border-[#1E2A3F] bg-slate-900/40";
  const certWarn = lightMode
    ? "border-rose-300 bg-rose-50"
    : "border-rose-500/50 bg-rose-950/40";
  const warnText = lightMode ? "text-rose-700 font-semibold" : "text-rose-300 font-semibold";
  const kmWarn =
    kmLeft < 500
      ? lightMode
        ? "text-rose-600 font-semibold"
        : "text-rose-400 font-semibold"
      : kmLeft < 1000
      ? lightMode
        ? "text-amber-600 font-medium"
        : "text-amber-400 font-medium"
      : muted;

  const progressColor =
    progress > 90 ? "bg-rose-500" : progress > 70 ? "bg-amber-500" : "bg-cyan-500";

  const riskBadge =
    typeof riskScore === "number"
      ? riskScore >= 70
        ? "bg-rose-600 text-white shadow-glow-rose"
        : riskScore >= 40
        ? "bg-amber-500 text-white shadow-glow-amber"
        : "bg-emerald-600 text-white"
      : null;

  return (
    <div
      onClick={() => onSelect?.(vehicle)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(vehicle);
        }
      }}
      className={`group relative border rounded-2xl p-4 cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 ${cardBase}`}
    >
      {/* Top row: plate + status */}
      <div className="flex justify-between items-start gap-3 mb-3.5">
        <div className="min-w-0">
          <h4 className="font-semibold text-[15px] leading-tight flex items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                lightMode
                  ? "bg-cyan-50 text-cyan-600"
                  : "bg-cyan-500/10 text-cyan-400"
              }`}
            >
              <Car className="w-3.5 h-3.5" />
            </span>
            <span
              className={`font-mono tracking-wide truncate ${
                lightMode ? "text-slate-900" : "text-slate-100"
              }`}
            >
              {vehicle.plate}
            </span>
          </h4>
          <p className={`text-xs mt-1 truncate ${muted}`}>
            {vehicle.vehicle_id} · {vehicle.make} {vehicle.model} ({vehicle.year})
          </p>
        </div>
        <span className={`ops-status shrink-0 ${statusStyles[statusKey]}`}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              statusKey === "active"
                ? "bg-emerald-400"
                : statusKey === "maintenance"
                ? "bg-amber-400"
                : statusKey === "accident"
                ? "bg-rose-400 animate-pulse-soft"
                : "bg-slate-400"
            }`}
          />
          {vehicle.status}
        </span>
      </div>

      {/* Service progress */}
      <div className="mb-3.5">
        <div className="flex justify-between items-center text-xs mb-1.5">
          <span className={`flex items-center gap-1.5 ${muted}`}>
            <Wrench className="w-3 h-3 opacity-70" />
            Service interval
          </span>
          <span className={`tabular-nums ${kmWarn}`}>{Math.round(kmLeft)} km left</span>
        </div>
        <div className={`ops-progress-track ${barTrack}`}>
          <div
            className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        <p className={`text-[11px] mt-1.5 flex items-center gap-1 ${mutedSoft}`}>
          <Gauge className="w-3 h-3 opacity-60" />
          Last: {formatDate(vehicle.last_service_date)} @{" "}
          {(vehicle.last_service_odometer ?? "—").toLocaleString?.() ?? vehicle.last_service_odometer ?? "—"} km
        </p>
      </div>

      {/* Roadworthy */}
      <div
        className={`rounded-xl border p-2.5 mb-3.5 ${
          roadDays !== null && roadDays <= 20 ? certWarn : certOk
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={`text-[10px] uppercase tracking-wider font-medium ${muted}`}>
              Roadworthy
            </p>
            <p
              className={`text-sm mt-0.5 tabular-nums ${
                roadDays !== null && roadDays <= 20 ? warnText : ""
              }`}
            >
              {formatDate(vehicle.roadworthy_expiry)}
            </p>
          </div>
          {roadDays !== null && (
            <span
              className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${
                roadDays < 0
                  ? lightMode
                    ? "bg-rose-600 text-white"
                    : "bg-rose-600 text-white"
                  : roadDays <= 7
                  ? lightMode
                    ? "bg-rose-100 text-rose-700"
                    : "bg-rose-500/20 text-rose-300"
                  : roadDays <= 20
                  ? lightMode
                    ? "bg-amber-100 text-amber-800"
                    : "bg-amber-500/20 text-amber-300"
                  : lightMode
                  ? "bg-slate-100 text-slate-600"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {roadDays < 0 ? "Expired" : `${roadDays}d`}
            </span>
          )}
        </div>
      </div>

      {/* Footer: income + risk */}
      <div className="flex justify-between items-center gap-2 pt-1">
        <span className={`text-xs tabular-nums ${muted}`}>
          R{Number(vehicle.estimated_daily_income || 0).toLocaleString()}
          <span className={mutedSoft}>/day</span>
        </span>
        {riskBadge && (
          <span
            className={`text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-lg ${riskBadge}`}
          >
            Risk {riskScore}
          </span>
        )}
      </div>

      {/* Subtle hover affordance */}
      {!highlighted && (
        <div
          className={`pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${
            lightMode ? "ring-1 ring-cyan-400/30" : "ring-1 ring-cyan-400/20"
          }`}
        />
      )}
    </div>
  );
}
