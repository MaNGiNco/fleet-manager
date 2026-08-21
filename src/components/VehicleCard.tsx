"use client";

import { kmToNextService, serviceProgress, daysUntil, formatDate } from "@/lib/utils";
import type { Vehicle } from "@/types";
import { AlertTriangle, Wrench, Fuel, Calendar, Car } from "lucide-react";

interface Props {
  vehicle: Vehicle;
  riskScore?: number;
  onSelect?: (v: Vehicle) => void;
  highlighted?: boolean;
}

export default function VehicleCard({ vehicle, riskScore, onSelect, highlighted }: Props) {
  const kmLeft = kmToNextService(vehicle);
  const progress = serviceProgress(vehicle);
  const coidaDays = daysUntil(vehicle.coida_expiry);
  const roadDays = daysUntil(vehicle.roadworthy_expiry);

  const statusColor =
    vehicle.status === "active"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-600"
      : vehicle.status === "maintenance"
      ? "bg-amber-500/20 text-amber-300 border-amber-600"
      : vehicle.status === "accident"
      ? "bg-red-500/20 text-red-300 border-red-600"
      : "bg-slate-500/20 text-slate-300 border-slate-600";

  return (
    <div
      onClick={() => onSelect?.(vehicle)}
      className={`bg-slate-900 border rounded-xl p-4 cursor-pointer transition hover:border-cyan-600 ${
        highlighted ? "border-cyan-400 ring-2 ring-cyan-400/40" : "border-slate-700"
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="font-semibold text-lg flex items-center gap-2">
            <Car className="w-4 h-4 text-cyan-400" />
            {vehicle.plate}
          </h4>
          <p className="text-sm text-slate-400">
            {vehicle.vehicle_id} · {vehicle.make} {vehicle.model} ({vehicle.year})
          </p>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full border ${statusColor}`}>
          {vehicle.status}
        </span>
      </div>

      {/* Service progress */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="flex items-center gap-1">
            <Wrench className="w-3 h-3" /> Service
          </span>
          <span className={kmLeft < 500 ? "text-red-400" : kmLeft < 1000 ? "text-amber-400" : "text-slate-400"}>
            {Math.round(kmLeft)} km left
          </span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              progress > 90 ? "bg-red-500" : progress > 70 ? "bg-amber-500" : "bg-cyan-500"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Last: {formatDate(vehicle.last_service_date)} @ {vehicle.last_service_odometer ?? "—"} km
        </p>
      </div>

      {/* Certificates */}
      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div className={`p-2 rounded border ${coidaDays !== null && coidaDays <= 20 ? "border-red-600 bg-red-900/30" : "border-slate-700"}`}>
          <p className="text-slate-400">COIDA</p>
          <p className={coidaDays !== null && coidaDays <= 20 ? "text-red-300 font-medium" : ""}>
            {formatDate(vehicle.coida_expiry)}
            {coidaDays !== null && (
              <span className="block text-[10px]">
                {coidaDays < 0 ? "EXPIRED" : `${coidaDays}d left`}
              </span>
            )}
          </p>
        </div>
        <div className={`p-2 rounded border ${roadDays !== null && roadDays <= 20 ? "border-red-600 bg-red-900/30" : "border-slate-700"}`}>
          <p className="text-slate-400">Roadworthy</p>
          <p className={roadDays !== null && roadDays <= 20 ? "text-red-300 font-medium" : ""}>
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
        <span className="text-slate-400">
          Est. income: R{Number(vehicle.estimated_daily_income || 0).toLocaleString()}/day
        </span>
        {typeof riskScore === "number" && (
          <span
            className={`font-bold px-2 py-0.5 rounded ${
              riskScore >= 70
                ? "bg-red-600 text-white"
                : riskScore >= 40
                ? "bg-amber-600 text-white"
                : "bg-emerald-700 text-white"
            }`}
          >
            Risk {riskScore}
          </span>
        )}
      </div>
    </div>
  );
}
