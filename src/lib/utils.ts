import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { differenceInDays, parseISO, format } from "date-fns";
import type { Vehicle, RiskScore, FuelImpact } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  try {
    return format(parseISO(date), "dd MMM yyyy");
  } catch {
    return date;
  }
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  try {
    return differenceInDays(parseISO(date), new Date());
  } catch {
    return null;
  }
}

/** km remaining until next service */
export function kmToNextService(v: Vehicle): number {
  const last = v.last_service_odometer ?? 0;
  const interval = v.service_interval_km || 5000;
  const nextAt = last + interval;
  return Math.max(0, nextAt - (v.current_odometer || 0));
}

/** percentage of service interval used */
export function serviceProgress(v: Vehicle): number {
  const last = v.last_service_odometer ?? 0;
  const interval = v.service_interval_km || 5000;
  const used = (v.current_odometer || 0) - last;
  return Math.min(100, Math.max(0, (used / interval) * 100));
}

export function calculateRiskScores(vehicles: Vehicle[]): RiskScore[] {
  return vehicles.map((v) => {
    const kmLeft = kmToNextService(v);
    const serviceRisk = Math.min(100, Math.max(0, 100 - (kmLeft / (v.service_interval_km || 5000)) * 100));

    // COIDA is company-level (not per vehicle) — only roadworthy affects vehicle cert risk
    const roadworthyDays = daysUntil(v.roadworthy_expiry);
    let certRisk = 0;
    const reasons: string[] = [];

    if (roadworthyDays !== null) {
      if (roadworthyDays < 0) {
        certRisk = 100;
        reasons.push("Roadworthy expired");
      } else if (roadworthyDays <= 20) {
        certRisk = Math.max(certRisk, 100 - roadworthyDays * 3);
        reasons.push(`Roadworthy expires in ${roadworthyDays} days`);
      }
    }

    // Income exposure: higher if vehicle is down or about to be
    let incomeExposure = 0;
    if (v.status === "accident" || v.status === "maintenance") {
      incomeExposure = Math.min(100, (v.estimated_daily_income || 0) / 50); // scale
      reasons.push(`Vehicle unavailable (${v.status}) – est. R${v.estimated_daily_income}/day lost`);
    } else if (serviceRisk > 80 || certRisk > 70) {
      incomeExposure = Math.min(80, (v.estimated_daily_income || 0) / 80);
      reasons.push("High chance of downtime soon");
    }

    if (serviceRisk > 70) reasons.push(`Service due soon (${Math.round(kmLeft)} km left)`);

    const totalRisk = Math.round(
      serviceRisk * 0.35 + certRisk * 0.4 + incomeExposure * 0.25
    );

    return {
      vehicle_id: v.id,
      plate: v.plate,
      service_risk: Math.round(serviceRisk),
      certificate_risk: Math.round(certRisk),
      income_exposure: Math.round(incomeExposure),
      total_risk: Math.min(100, totalRisk),
      reasons,
    };
  }).sort((a, b) => b.total_risk - a.total_risk);
}

export function calculateFuelImpacts(
  vehicles: Vehicle[],
  fuelUsageByVehicle: Record<string, number>, // liters used
  totalReserve: number
): FuelImpact[] {
  const totalUsed = Object.values(fuelUsageByVehicle).reduce((a, b) => a + b, 0) || 1;

  return vehicles.map((v) => {
    const used = fuelUsageByVehicle[v.id] || 0;
    const pct = totalReserve > 0 ? (used / totalReserve) * 100 : 0;
    let rating: FuelImpact["impact_rating"] = "low";
    if (pct > 25) rating = "critical";
    else if (pct > 15) rating = "high";
    else if (pct > 8) rating = "medium";

    // efficiency relative to fleet average
    const fleetAvgEff = vehicles.reduce((s, x) => s + (x.fuel_efficiency_l_per_100km || 10), 0) / (vehicles.length || 1);
    const thisEff = v.fuel_efficiency_l_per_100km || fleetAvgEff;
    const efficiency_score = Math.max(0, Math.min(100, 100 - ((thisEff - fleetAvgEff) / fleetAvgEff) * 50));

    return {
      vehicle_id: v.id,
      plate: v.plate,
      total_liters_used: used,
      percentage_of_reserve: Math.round(pct * 10) / 10,
      efficiency_score: Math.round(efficiency_score),
      impact_rating: rating,
    };
  }).sort((a, b) => b.percentage_of_reserve - a.percentage_of_reserve);
}
