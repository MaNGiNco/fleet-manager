"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Vehicle, RiskScore, FuelImpact } from "@/types";
import { calculateRiskScores, calculateFuelImpacts, kmToNextService, daysUntil } from "@/lib/utils";
import VehicleCard from "@/components/VehicleCard";
import DocumentScanner from "@/components/DocumentScanner";
import {
  LayoutDashboard,
  AlertTriangle,
  Fuel,
  RefreshCw,
  Users,
  CalendarClock,
  Brain,
  Loader2,
} from "lucide-react";

// Demo seed data when Supabase is not configured
const DEMO_VEHICLES: Vehicle[] = [
  {
    id: "1",
    plate: "CA 123-456",
    vehicle_id: "FLT-001",
    make: "Toyota",
    model: "Hilux",
    year: 2021,
    current_odometer: 78450,
    last_service_date: "2026-05-12",
    last_service_odometer: 74000,
    service_interval_km: 5000,
    coida_expiry: "2026-09-05",
    roadworthy_expiry: "2026-08-28",
    status: "active",
    estimated_daily_income: 1850,
    fuel_efficiency_l_per_100km: 9.2,
    assigned_driver_id: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "2",
    plate: "GP 78 XY GP",
    vehicle_id: "FLT-002",
    make: "Isuzu",
    model: "D-Max",
    year: 2020,
    current_odometer: 112300,
    last_service_date: "2026-03-01",
    last_service_odometer: 108000,
    service_interval_km: 5000,
    coida_expiry: "2026-08-15",
    roadworthy_expiry: "2026-10-01",
    status: "maintenance",
    estimated_daily_income: 2100,
    fuel_efficiency_l_per_100km: 10.5,
    assigned_driver_id: null,
    notes: "Clutch replacement",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "3",
    plate: "NW 456-789",
    vehicle_id: "FLT-003",
    make: "Ford",
    model: "Ranger",
    year: 2022,
    current_odometer: 45200,
    last_service_date: "2026-07-20",
    last_service_odometer: 42000,
    service_interval_km: 5000,
    coida_expiry: "2027-01-10",
    roadworthy_expiry: "2026-12-15",
    status: "active",
    estimated_daily_income: 1950,
    fuel_efficiency_l_per_100km: 8.8,
    assigned_driver_id: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "4",
    plate: "KZN 321 AB",
    vehicle_id: "FLT-004",
    make: "Mercedes",
    model: "Sprinter",
    year: 2019,
    current_odometer: 198700,
    last_service_date: "2026-01-15",
    last_service_odometer: 195000,
    service_interval_km: 5000,
    coida_expiry: "2026-08-25",
    roadworthy_expiry: "2026-09-01",
    status: "accident",
    estimated_daily_income: 3200,
    fuel_efficiency_l_per_100km: 12.1,
    assigned_driver_id: null,
    notes: "Front end damage – insurance claim open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "5",
    plate: "WC 987-654",
    vehicle_id: "FLT-005",
    make: "Nissan",
    model: "NP200",
    year: 2023,
    current_odometer: 22100,
    last_service_date: "2026-06-01",
    last_service_odometer: 18000,
    service_interval_km: 5000,
    coida_expiry: "2027-03-20",
    roadworthy_expiry: "2027-02-28",
    status: "active",
    estimated_daily_income: 1100,
    fuel_efficiency_l_per_100km: 7.5,
    assigned_driver_id: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default function DashboardPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [risks, setRisks] = useState<RiskScore[]>([]);
  const [fuelImpacts, setFuelImpacts] = useState<FuelImpact[]>([]);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [fuelReserve, setFuelReserve] = useState(8500);
  const [usingDemo, setUsingDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  const [dataError, setDataError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setDataError(null);
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
      const hasSupabase = Boolean(supabaseUrl);

      console.log("[Fleet] NEXT_PUBLIC_SUPABASE_URL present:", hasSupabase, "value starts with:", supabaseUrl.slice(0, 30));

      if (hasSupabase) {
        const { data, error } = await supabase.from("vehicles").select("*").order("plate");
        console.log("[Fleet] Supabase vehicles response:", { error, count: data?.length, firstPlate: data?.[0]?.plate });

        if (error) {
          setDataError(`Supabase error: ${error.message} (code: ${error.code || "n/a"})`);
          setVehicles(DEMO_VEHICLES);
          setUsingDemo(true);
        } else if (!data || data.length === 0) {
          setDataError("Supabase connected but returned 0 vehicles. Check RLS policies or that seed data exists.");
          setVehicles(DEMO_VEHICLES);
          setUsingDemo(true);
        } else {
          setVehicles(data as Vehicle[]);
          setUsingDemo(false);
          setDataError(null);
        }

        const { data: reserve } = await supabase.from("fuel_reserve").select("current_liters").limit(1).single();
        if (reserve) setFuelReserve(Number(reserve.current_liters));
      } else {
        setDataError("NEXT_PUBLIC_SUPABASE_URL is missing in this deployment. Add it in Vercel → Settings → Environment Variables and redeploy.");
        setVehicles(DEMO_VEHICLES);
        setUsingDemo(true);
      }
    } catch (err: any) {
      console.error("[Fleet] loadData exception:", err);
      setDataError(`Exception: ${err?.message || String(err)}`);
      setVehicles(DEMO_VEHICLES);
      setUsingDemo(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (vehicles.length) {
      setRisks(calculateRiskScores(vehicles));
      // Mock fuel usage for demo
      const usage: Record<string, number> = {};
      vehicles.forEach((v, i) => {
        usage[v.id] = [1200, 980, 650, 1450, 420][i] || 500;
      });
      setFuelImpacts(calculateFuelImpacts(vehicles, usage, fuelReserve));
    }
  }, [vehicles, fuelReserve]);

  const runAnalytics = async () => {
    setLoadingAnalytics(true);
    try {
      const res = await fetch("/api/analytics", { method: "POST" });
      const data = await res.json();
      if (data.success) setAnalytics(data);
      else setAnalytics({ error: data.error });
    } catch (e: any) {
      setAnalytics({ error: e.message });
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const downVehicles = vehicles.filter((v) => v.status === "maintenance" || v.status === "accident");
  const certAlerts = vehicles.filter((v) => {
    const c = daysUntil(v.coida_expiry);
    const r = daysUntil(v.roadworthy_expiry);
    return (c !== null && c <= 20) || (r !== null && r <= 20);
  });

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="w-7 h-7 text-cyan-400" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Fleet Manager</h1>
              <p className="text-xs text-slate-400">Downtime · Compliance · Fuel · Risk</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {usingDemo && (
              <span className="text-xs bg-amber-900/50 text-amber-300 px-2 py-1 rounded">
                Demo data
              </span>
            )}
            <button
              onClick={loadData}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 transition"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {dataError && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="bg-red-950/80 border border-red-700 text-red-200 text-sm rounded-lg p-4">
            <strong className="block mb-1">Database connection issue</strong>
            {dataError}
            <p className="mt-2 text-xs text-red-300/80">Open browser console (F12) for more details. Fix the issue then click the refresh button.</p>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* KPI strip */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase">Total Vehicles</p>
            <p className="text-2xl font-bold">{vehicles.length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase">Down / Offline</p>
            <p className="text-2xl font-bold text-red-400">{downVehicles.length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase">Certs ≤20 days</p>
            <p className="text-2xl font-bold text-amber-400">{certAlerts.length}</p>
          </div>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase">Fuel Reserve</p>
            <p className="text-2xl font-bold text-cyan-400">{fuelReserve.toLocaleString()} L</p>
          </div>
        </section>

        {/* Risk Ranking */}
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            Risk Ranking (Service + Certificates + Income Exposure)
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {risks.map((r) => {
              const v = vehicles.find((x) => x.id === r.vehicle_id);
              if (!v) return null;
              return (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  riskScore={r.total_risk}
                  onSelect={setSelected}
                  highlighted={selected?.id === v.id}
                />
              );
            })}
          </div>
        </section>

        {/* Downtime & Reschedule helper */}
        {downVehicles.length > 0 && (
          <section className="bg-slate-900 border border-red-900/50 rounded-xl p-5">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-red-300">
              <CalendarClock className="w-5 h-5" />
              Vehicles Offline – Schedule Shuffle Needed
            </h2>
            <div className="space-y-3">
              {downVehicles.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-800/60 rounded-lg">
                  <div>
                    <p className="font-medium">
                      {v.plate} ({v.vehicle_id}) – {v.status}
                    </p>
                    <p className="text-sm text-slate-400">{v.notes || "No notes"}</p>
                    <p className="text-xs text-red-300">
                      Income exposure: ~R{Number(v.estimated_daily_income).toLocaleString()}/day
                    </p>
                  </div>
                  <div className="text-sm text-slate-300">
                    <p>Suggested: Reassign jobs to highest-availability active vehicles with similar capacity.</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Active candidates:{" "}
                      {vehicles
                        .filter((x) => x.status === "active" && x.id !== v.id)
                        .slice(0, 3)
                        .map((x) => x.plate)
                        .join(", ") || "None"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Fuel Impact */}
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Fuel className="w-5 h-5 text-cyan-400" />
            Fuel Impact on Bulk Reserve
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-700">
                  <th className="py-2 pr-4">Vehicle</th>
                  <th className="py-2 pr-4">Litres Used</th>
                  <th className="py-2 pr-4">% of Reserve</th>
                  <th className="py-2 pr-4">Efficiency Score</th>
                  <th className="py-2">Impact Rating</th>
                </tr>
              </thead>
              <tbody>
                {fuelImpacts.map((f) => (
                  <tr key={f.vehicle_id} className="border-b border-slate-800">
                    <td className="py-2 pr-4 font-mono">{f.plate}</td>
                    <td className="py-2 pr-4">{f.total_liters_used.toLocaleString()} L</td>
                    <td className="py-2 pr-4">{f.percentage_of_reserve}%</td>
                    <td className="py-2 pr-4">{f.efficiency_score}/100</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          f.impact_rating === "critical"
                            ? "bg-red-600"
                            : f.impact_rating === "high"
                            ? "bg-orange-600"
                            : f.impact_rating === "medium"
                            ? "bg-amber-600"
                            : "bg-emerald-700"
                        }`}
                      >
                        {f.impact_rating}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Document Scanner */}
        <DocumentScanner
          onMatch={(v) => {
            setSelected(v);
            // Optionally refresh list
            loadData();
          }}
        />

        {/* AI Analytics */}
        <section className="bg-slate-900 border border-slate-700 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Brain className="w-5 h-5 text-violet-400" />
              AI Analytics & Recommendations
            </h2>
            <button
              onClick={runAnalytics}
              disabled={loadingAnalytics}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium transition"
            >
              {loadingAnalytics ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              Generate Insights
            </button>
          </div>

          {analytics?.error && (
            <p className="text-red-400 text-sm">{analytics.error}</p>
          )}

          {analytics?.recommendations && (
            <div className="space-y-4 text-sm">
              {analytics.recommendations.risk_summary && (
                <p className="text-slate-300 leading-relaxed">{analytics.recommendations.risk_summary}</p>
              )}
              {analytics.recommendations.priority_actions && (
                <div>
                  <h4 className="font-medium text-violet-300 mb-1">Priority Actions</h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-300">
                    {analytics.recommendations.priority_actions.map((a: string, i: number) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analytics.recommendations.downtime_mitigation && (
                <div>
                  <h4 className="font-medium text-amber-300 mb-1">Downtime Mitigation / Schedule Shuffle</h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-300">
                    {analytics.recommendations.downtime_mitigation.map((a: string, i: number) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analytics.recommendations.compliance_alerts && (
                <div>
                  <h4 className="font-medium text-red-300 mb-1">Compliance</h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-300">
                    {analytics.recommendations.compliance_alerts.map((a: string, i: number) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analytics.recommendations.fuel_recommendations && (
                <div>
                  <h4 className="font-medium text-cyan-300 mb-1">Fuel</h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-300">
                    {analytics.recommendations.fuel_recommendations.map((a: string, i: number) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analytics.recommendations.estimated_impact && (
                <p className="text-emerald-300 border-t border-slate-700 pt-3">
                  {analytics.recommendations.estimated_impact}
                </p>
              )}
            </div>
          )}

          {!analytics && !loadingAnalytics && (
            <p className="text-slate-500 text-sm">
              Click “Generate Insights” to receive AI-powered recommendations based on current risk, certificates, downtime and fuel data.
            </p>
          )}
        </section>

        {selected && (
          <div className="fixed bottom-4 right-4 max-w-sm bg-slate-800 border border-cyan-600 rounded-xl p-4 shadow-xl z-30">
            <p className="text-xs text-cyan-400 mb-1">Selected</p>
            <p className="font-semibold">{selected.plate}</p>
            <p className="text-sm text-slate-400">
              {selected.make} {selected.model} · {selected.status}
            </p>
            <button
              onClick={() => setSelected(null)}
              className="mt-2 text-xs text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
