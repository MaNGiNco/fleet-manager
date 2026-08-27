"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Vehicle, RiskScore, FuelImpact, Driver, Schedule } from "@/types";
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
  Phone,
  ChevronDown,
  ChevronUp,
  Camera,
  Sun,
  Moon,
  X,
  Wrench,
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
    current_fuel_level_pct: 62,
    last_refuel_date: "2026-08-18",
    assigned_driver_id: "d1",
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
    current_fuel_level_pct: 40,
    last_refuel_date: "2026-08-10",
    assigned_driver_id: "d2",
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
    current_fuel_level_pct: 75,
    last_refuel_date: "2026-08-20",
    assigned_driver_id: "d4",
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
    current_fuel_level_pct: 28,
    last_refuel_date: "2026-08-12",
    assigned_driver_id: "d6",
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
    current_fuel_level_pct: 90,
    last_refuel_date: "2026-08-22",
    assigned_driver_id: null,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export default function DashboardPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [risks, setRisks] = useState<RiskScore[]>([]);
  const [fuelImpacts, setFuelImpacts] = useState<FuelImpact[]>([]);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  /** Where the vehicle was opened from — controls which AI panel is shown */
  const [selectedContext, setSelectedContext] = useState<"risk" | "fuel" | "other" | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [driverSheetClosing, setDriverSheetClosing] = useState(false);
  const [showSchedulesView, setShowSchedulesView] = useState(false);
  const [scheduleAnalytics, setScheduleAnalytics] = useState<any>(null);
  const [loadingScheduleAnalytics, setLoadingScheduleAnalytics] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [fuelAnalytics, setFuelAnalytics] = useState<any>(null);
  const [loadingFuelAnalytics, setLoadingFuelAnalytics] = useState(false);
  const [serviceAnalytics, setServiceAnalytics] = useState<any>(null);
  const [loadingServiceAnalytics, setLoadingServiceAnalytics] = useState(false);
  const [fuelReserve, setFuelReserve] = useState(8500);
  const [companyCoidaExpiry, setCompanyCoidaExpiry] = useState<string | null>("2026-09-15");
  const [usingDemo, setUsingDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [showAllRisk, setShowAllRisk] = useState(false);
  const [showAllFuel, setShowAllFuel] = useState(false);
  const [showAllDrivers, setShowAllDrivers] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [sheetClosing, setSheetClosing] = useState(false);

  const closeSheet = () => {
    if (sheetClosing) return;
    setSheetClosing(true);
    window.setTimeout(() => {
      setSelected(null);
      setSelectedContext(null);
      setFuelAnalytics(null);
      setServiceAnalytics(null);
      setSheetClosing(false);
    }, 240);
  };

  const closeDriverSheet = () => {
    if (driverSheetClosing) return;
    setDriverSheetClosing(true);
    window.setTimeout(() => {
      setSelectedDriver(null);
      setDriverSheetClosing(false);
    }, 240);
  };

  const openDriver = (d: Driver) => {
    setSelected(null);
    setSelectedContext(null);
    setSelectedDriver(d);
  };

  const loadScheduleAnalytics = async () => {
    setLoadingScheduleAnalytics(true);
    try {
      const res = await fetch("/api/schedule-analytics", { method: "POST" });
      const data = await res.json();
      if (data?.success) setScheduleAnalytics(data);
      else setScheduleAnalytics({ error: data?.error || "Failed to load" });
    } catch (e: any) {
      setScheduleAnalytics({ error: e?.message || "Failed" });
    } finally {
      setLoadingScheduleAnalytics(false);
    }
  };

  const openSchedulesView = () => {
    setShowSchedulesView(true);
    loadScheduleAnalytics();
    // also refresh local schedules list
    loadData();
  };

  // Load only the analytics relevant to where the vehicle was opened from
  useEffect(() => {
    if (!selected?.id || !selectedContext) {
      setFuelAnalytics(null);
      setServiceAnalytics(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      if (selectedContext === "fuel") {
        setServiceAnalytics(null);
        setLoadingFuelAnalytics(true);
        try {
          const res = await fetch("/api/fuel-analytics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vehicleId: selected.id }),
          });
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setFuelAnalytics(data?.analytics || null);
        } catch {
          if (!cancelled) setFuelAnalytics(null);
        } finally {
          if (!cancelled) setLoadingFuelAnalytics(false);
        }
      } else if (selectedContext === "risk") {
        setFuelAnalytics(null);
        setLoadingServiceAnalytics(true);
        try {
          const res = await fetch("/api/service-analytics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vehicleId: selected.id }),
          });
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setServiceAnalytics(data?.analytics || null);
        } catch {
          if (!cancelled) setServiceAnalytics(null);
        } finally {
          if (!cancelled) setLoadingServiceAnalytics(false);
        }
      } else {
        // other (e.g. scan match) — no AI analytics panels
        setFuelAnalytics(null);
        setServiceAnalytics(null);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selectedContext]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;

    setActiveSection(id);

    // Smooth scroll with header offset — rAF avoids layout jump on mobile
    requestAnimationFrame(() => {
      const headerOffset = 100; // sticky header clearance
      const rect = el.getBoundingClientRect();
      const targetY = Math.max(0, window.scrollY + rect.top - headerOffset);

      window.scrollTo({
        top: targetY,
        left: 0,
        behavior: "smooth",
      });
    });
  };

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

        const { data: compliance } = await supabase
          .from("company_compliance")
          .select("coida_expiry")
          .limit(1)
          .maybeSingle();
        if (compliance?.coida_expiry) setCompanyCoidaExpiry(compliance.coida_expiry);

        const { data: driversData } = await supabase.from("drivers").select("*").order("name");
        if (driversData) setDrivers(driversData as Driver[]);

        const { data: schedulesData } = await supabase
          .from("schedules")
          .select("*")
          .order("start_time", { ascending: false })
          .limit(100);
        if (schedulesData) setSchedules(schedulesData as Schedule[]);
      } else {
        setDataError("NEXT_PUBLIC_SUPABASE_URL is missing in this deployment. Add it in Vercel → Settings → Environment Variables and redeploy.");
        setVehicles(DEMO_VEHICLES);
        setUsingDemo(true);
        // Demo drivers for offline mode
        setDrivers([
          { id: "d1", name: "Thabo Molefe", license_number: "GP123456", phone: "0821110001", status: "assigned", created_at: new Date().toISOString() },
          { id: "d2", name: "Sipho Dlamini", license_number: "KZN789012", phone: "0832220002", status: "assigned", created_at: new Date().toISOString() },
          { id: "d3", name: "Johan van der Berg", license_number: "WC345678", phone: "0843330003", status: "available", created_at: new Date().toISOString() },
          { id: "d4", name: "Lindiwe Nkosi", license_number: "GP901234", phone: "0824440004", status: "assigned", created_at: new Date().toISOString() },
          { id: "d5", name: "Pieter Botha", license_number: "EC567890", phone: "0835550005", status: "off", created_at: new Date().toISOString() },
          { id: "d6", name: "Nomsa Khumalo", license_number: "KZN112233", phone: "0846660006", status: "assigned", created_at: new Date().toISOString() },
          { id: "d7", name: "Andile Mbeki", license_number: "GP445566", phone: "0827770007", status: "available", created_at: new Date().toISOString() },
          { id: "d8", name: "Fatima Abrahams", license_number: "WC778899", phone: "0838880008", status: "assigned", created_at: new Date().toISOString() },
          { id: "d9", name: "Ruan Pretorius", license_number: "NW001122", phone: "0849990009", status: "assigned", created_at: new Date().toISOString() },
          { id: "d10", name: "Zanele Sithole", license_number: "GP334455", phone: "0820000010", status: "available", created_at: new Date().toISOString() },
          { id: "d11", name: "David Naidoo", license_number: "KZN667788", phone: "0831110011", status: "assigned", created_at: new Date().toISOString() },
          { id: "d12", name: "Elmarie du Plessis", license_number: "WC990011", phone: "0842220012", status: "off", created_at: new Date().toISOString() },
        ]);

        // Demo schedules so driver sheet has data offline
        const now = Date.now();
        const hr = 3600000;
        setSchedules([
          { id: "s1", vehicle_id: "1", driver_id: "d1", start_time: new Date(now + 2*hr).toISOString(), end_time: new Date(now + 6*hr).toISOString(), job_description: "150km delivery Gauteng", status: "scheduled", created_at: new Date().toISOString() },
          { id: "s2", vehicle_id: "1", driver_id: "d1", start_time: new Date(now - 24*hr).toISOString(), end_time: new Date(now - 20*hr).toISOString(), job_description: "80km local runs", status: "completed", created_at: new Date().toISOString() },
          { id: "s3", vehicle_id: "3", driver_id: "d2", start_time: new Date(now + 5*hr).toISOString(), end_time: new Date(now + 10*hr).toISOString(), job_description: "220km Cape corridor", status: "scheduled", created_at: new Date().toISOString() },
          { id: "s4", vehicle_id: "3", driver_id: "d2", start_time: new Date(now + 28*hr).toISOString(), end_time: new Date(now + 34*hr).toISOString(), job_description: "120km depot shuttle", status: "scheduled", created_at: new Date().toISOString() },
          { id: "s5", vehicle_id: "5", driver_id: "d4", start_time: new Date(now + 3*hr).toISOString(), end_time: new Date(now + 8*hr).toISOString(), job_description: "95km client collection", status: "scheduled", created_at: new Date().toISOString() },
          { id: "s6", vehicle_id: "4", driver_id: "d6", start_time: new Date(now - 5*hr).toISOString(), end_time: new Date(now - 1*hr).toISOString(), job_description: "60km urban drops", status: "completed", created_at: new Date().toISOString() },
          { id: "s7", vehicle_id: "1", driver_id: "d8", start_time: new Date(now + 48*hr).toISOString(), end_time: new Date(now + 54*hr).toISOString(), job_description: "180km inter-depot", status: "scheduled", created_at: new Date().toISOString() },
          { id: "s8", vehicle_id: "3", driver_id: "d9", start_time: new Date(now + 12*hr).toISOString(), end_time: new Date(now + 16*hr).toISOString(), job_description: "110km site inspection", status: "scheduled", created_at: new Date().toISOString() },
          { id: "s9", vehicle_id: "5", driver_id: "d11", start_time: new Date(now + 30*hr).toISOString(), end_time: new Date(now + 36*hr).toISOString(), job_description: "140km bulk drop", status: "scheduled", created_at: new Date().toISOString() },
        ]);
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
    const r = daysUntil(v.roadworthy_expiry);
    return r !== null && r <= 20;
  });

  const companyCoidaDays = daysUntil(companyCoidaExpiry);
  const coidaStatus =
    companyCoidaDays === null
      ? { label: "Unknown", color: "slate", days: null as number | null }
      : companyCoidaDays < 0
      ? { label: "EXPIRED — renew immediately", color: "red", days: companyCoidaDays }
      : companyCoidaDays <= 30
      ? { label: "Renew within 30 days", color: "red", days: companyCoidaDays }
      : companyCoidaDays <= 50
      ? { label: "Renewal window approaching", color: "yellow", days: companyCoidaDays }
      : { label: "Valid — plenty of time", color: "green", days: companyCoidaDays };

  const theme = lightMode
    ? {
        page: "min-h-screen bg-slate-100 text-slate-900 pb-24",
        header: "border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-20",
        muted: "text-slate-500",
        card: "bg-white border border-slate-200",
        cardMuted: "text-slate-500",
        tableBorder: "border-slate-200",
        rowBorder: "border-slate-100",
        btn: "bg-slate-200 hover:bg-slate-300 text-slate-800",
        seeMore: "bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-800",
        nav: "bg-white border-t border-slate-200",
        navActive: "text-cyan-600",
        navIdle: "text-slate-500",
        summary: "bg-slate-50 border-b border-slate-200 text-slate-700",
        error: "bg-red-50 border-red-300 text-red-800",
        popup: "bg-white border-slate-300 text-slate-900",
      }
    : {
        page: "min-h-screen bg-slate-950 text-slate-100 pb-24",
        header: "border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-20",
        muted: "text-slate-400",
        card: "bg-slate-900 border border-slate-700",
        cardMuted: "text-slate-400",
        tableBorder: "border-slate-700",
        rowBorder: "border-slate-800",
        btn: "bg-slate-800 hover:bg-slate-700 text-slate-100",
        seeMore: "bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-100",
        nav: "bg-slate-900 border-t border-slate-700",
        navActive: "text-cyan-400",
        navIdle: "text-slate-400",
        summary: "bg-slate-900/90 border-b border-slate-800 text-slate-300",
        error: "bg-red-950/80 border-red-700 text-red-200",
        popup: "bg-slate-800 border-cyan-600 text-slate-100",
      };

  return (
    <div className={theme.page}>
      {/* Header */}
      <header className={theme.header}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="w-7 h-7 text-cyan-500" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Fleet Manager</h1>
              <p className={`text-xs ${theme.muted}`}>Downtime · Compliance · Fuel · Risk</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {usingDemo && (
              <span className="text-xs bg-amber-500/20 text-amber-600 px-2 py-1 rounded">
                Demo data
              </span>
            )}
            <button
              onClick={openSchedulesView}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg ${theme.btn} transition ${
                showSchedulesView ? "ring-2 ring-violet-500" : ""
              }`}
              title="Schedules — vehicles, drivers & AI clash analysis"
            >
              <CalendarClock className="w-5 h-5 text-violet-500" />
            </button>
            <button
              onClick={() => setLightMode(!lightMode)}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg ${theme.btn} transition`}
              title={lightMode ? "Dark mode" : "Light mode (outdoor)"}
            >
              {lightMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg ${theme.btn} transition disabled:opacity-50`}
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

      </header>

      {/* Full schedules board */}
      {showSchedulesView && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/50">
          <div className={`flex-1 m-0 sm:m-4 sm:rounded-2xl overflow-hidden flex flex-col ${theme.popup} border ${theme.tableBorder} shadow-2xl`}>
            <div className={`flex items-center justify-between gap-3 px-4 py-3 border-b ${theme.tableBorder}`}>
              <div className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-violet-500" />
                <div>
                  <p className="font-semibold">Fleet schedules</p>
                  <p className={`text-xs ${theme.cardMuted}`}>
                    Drivers · vehicles · clashes · AI optimisation
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadScheduleAnalytics}
                  disabled={loadingScheduleAnalytics}
                  className={`min-h-[44px] px-3 rounded-lg text-sm ${theme.btn}`}
                >
                  {loadingScheduleAnalytics ? "Refreshing…" : "Refresh AI"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSchedulesView(false)}
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg ${theme.btn}`}
                  aria-label="Close schedules"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
              {/* AI analytics */}
              <div className={`rounded-xl border p-4 space-y-3 ${theme.tableBorder}`}>
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Brain className="w-4 h-4 text-cyan-500" />
                  AI schedule analytics
                </p>
                {loadingScheduleAnalytics && (
                  <div className="flex items-center gap-2 text-xs text-cyan-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Analysing clashes, fuel flags and routes…
                  </div>
                )}
                {scheduleAnalytics?.error && (
                  <p className="text-sm text-red-500">{scheduleAnalytics.error}</p>
                )}
                {scheduleAnalytics && !scheduleAnalytics.error && (
                  <>
                    <p className={`text-sm ${theme.cardMuted}`}>{scheduleAnalytics.ai_summary}</p>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className={`rounded-lg border p-2 ${theme.tableBorder}`}>
                        <p className="text-lg font-bold">{scheduleAnalytics.counts?.total ?? 0}</p>
                        <p className={theme.cardMuted}>Jobs</p>
                      </div>
                      <div className={`rounded-lg border p-2 ${theme.tableBorder}`}>
                        <p className="text-lg font-bold text-red-500">
                          {scheduleAnalytics.counts?.clashes ?? 0}
                        </p>
                        <p className={theme.cardMuted}>Clashes</p>
                      </div>
                      <div className={`rounded-lg border p-2 ${theme.tableBorder}`}>
                        <p className="text-lg font-bold text-amber-500">
                          {scheduleAnalytics.counts?.fuel_flags ?? 0}
                        </p>
                        <p className={theme.cardMuted}>Fuel flags</p>
                      </div>
                    </div>
                    {Array.isArray(scheduleAnalytics.clashes) && scheduleAnalytics.clashes.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-red-500">Clashes</p>
                        {scheduleAnalytics.clashes.slice(0, 12).map((c: any, i: number) => (
                          <p key={i} className="text-xs text-red-400/90">
                            · {c.message}
                            {c.jobs ? ` — ${c.jobs.filter(Boolean).join(" / ")}` : ""}
                          </p>
                        ))}
                      </div>
                    )}
                    {Array.isArray(scheduleAnalytics.fuel_flags) &&
                      scheduleAnalytics.fuel_flags.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-amber-500">Fuel vs schedule</p>
                          {scheduleAnalytics.fuel_flags.map((f: any, i: number) => (
                            <p key={i} className="text-xs text-amber-600/90">
                              · {f.message}
                            </p>
                          ))}
                        </div>
                      )}
                    {Array.isArray(scheduleAnalytics.top_locations) &&
                      scheduleAnalytics.top_locations.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium">Delivery locations</p>
                          <div className="flex flex-wrap gap-1.5">
                            {scheduleAnalytics.top_locations.map((l: any, i: number) => (
                              <span
                                key={i}
                                className={`text-[10px] px-2 py-1 rounded-full border ${theme.tableBorder}`}
                              >
                                {l.name} · {l.count}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    {Array.isArray(scheduleAnalytics.optimisations) && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-emerald-500">Optimisations</p>
                        <ul className="list-disc list-inside text-xs space-y-0.5">
                          {scheduleAnalytics.optimisations.map((o: string, i: number) => (
                            <li key={i} className={theme.cardMuted}>
                              {o}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Schedule table */}
              <div className={`rounded-xl border overflow-x-auto ${theme.tableBorder}`}>
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className={`text-left ${theme.cardMuted} border-b ${theme.tableBorder}`}>
                      <th className="py-2 px-3">When</th>
                      <th className="py-2 px-3">Vehicle</th>
                      <th className="py-2 px-3">Driver</th>
                      <th className="py-2 px-3">Job / location</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scheduleAnalytics?.schedules || schedules)
                      .slice()
                      .sort(
                        (a: any, b: any) =>
                          new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
                      )
                      .map((s: any) => {
                        const v =
                          vehicles.find((x) => x.id === s.vehicle_id) ||
                          (s.plate ? { plate: s.plate, vehicle_id: s.vehicle_fleet_id } : null);
                        const d =
                          drivers.find((x) => x.id === s.driver_id) ||
                          (s.driver_name ? { name: s.driver_name } : null);
                        return (
                          <tr key={s.id} className={`border-b ${theme.tableBorder}`}>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {new Date(s.start_time).toLocaleString("en-ZA", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                            <td className="py-2 px-3 font-mono">
                              {s.plate || v?.plate || "—"}
                            </td>
                            <td className="py-2 px-3">{s.driver_name || d?.name || "—"}</td>
                            <td className="py-2 px-3">
                              {s.job_type ? `${s.job_type} · ` : ""}
                              {s.location || s.job_description || "—"}
                            </td>
                            <td className="py-2 px-3 capitalize">{s.status}</td>
                          </tr>
                        );
                      })}
                    {(scheduleAnalytics?.schedules || schedules).length === 0 && (
                      <tr>
                        <td colSpan={5} className={`py-6 text-center ${theme.cardMuted}`}>
                          No schedules yet — scan a dispatch / trip sheet to add jobs.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}


      {dataError && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className={`${theme.error} border text-sm rounded-lg p-4`}>
            <strong className="block mb-1">Database connection issue</strong>
            {dataError}
            <button
              onClick={loadData}
              className="mt-3 min-h-[44px] px-4 rounded-lg bg-red-600 text-white text-sm font-medium"
            >
              Retry connection
            </button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* KPI strip */}
        <section id="overview" className="grid grid-cols-2 md:grid-cols-4 gap-4 scroll-mt-32">
          <div className={`${theme.card} rounded-xl p-4`}>
            <p className={`text-xs ${theme.cardMuted} uppercase`}>Total Vehicles</p>
            <p className="text-2xl font-bold">{vehicles.length}</p>
          </div>
          <div className={`${theme.card} rounded-xl p-4`}>
            <p className={`text-xs ${theme.cardMuted} uppercase`}>Down / Offline</p>
            <p className="text-2xl font-bold text-red-500">{downVehicles.length}</p>
          </div>
          <div className={`${theme.card} rounded-xl p-4`}>
            <p className={`text-xs ${theme.cardMuted} uppercase`}>Roadworthy ≤20 days</p>
            <p className="text-2xl font-bold text-amber-500">{certAlerts.length}</p>
          </div>
          <div className={`${theme.card} rounded-xl p-4`}>
            <p className={`text-xs ${theme.cardMuted} uppercase`}>Fuel Reserve</p>
            <p className="text-2xl font-bold text-cyan-600">{fuelReserve.toLocaleString()} L</p>
          </div>
        </section>

        {/* Company COIDA (business-level, not per vehicle) */}
        <section id="coida" className="scroll-mt-32">
          <div
            className={`rounded-xl border p-4 sm:p-5 ${
              coidaStatus.color === "red"
                ? lightMode
                  ? "bg-red-50 border-red-300 text-slate-900"
                  : "bg-red-950/40 border-red-700 text-slate-100"
                : coidaStatus.color === "yellow"
                ? lightMode
                  ? "bg-amber-50 border-amber-300 text-slate-900"
                  : "bg-amber-950/30 border-amber-600 text-slate-100"
                : lightMode
                ? "bg-emerald-50 border-emerald-300 text-slate-900"
                : "bg-emerald-950/30 border-emerald-700 text-slate-100"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  Company COIDA certificate
                </h2>
                <p className={`text-sm mt-1 ${lightMode ? "text-slate-600" : "text-slate-300"}`}>
                  Applies to the whole business (all drivers & vehicles) — not issued per vehicle.
                </p>
              </div>
              <span
                className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide ${
                  coidaStatus.color === "red"
                    ? "bg-red-600 text-white"
                    : coidaStatus.color === "yellow"
                    ? "bg-amber-500 text-white"
                    : "bg-emerald-600 text-white"
                }`}
              >
                {coidaStatus.color === "red"
                  ? "Red"
                  : coidaStatus.color === "yellow"
                  ? "Yellow"
                  : "Green"}
              </span>
            </div>
            <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className={lightMode ? "text-slate-500" : "text-slate-400"}>Expiry date</p>
                <p className="text-xl font-semibold mt-0.5">
                  {companyCoidaExpiry
                    ? new Date(companyCoidaExpiry).toLocaleDateString("en-ZA", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : "Not set"}
                </p>
              </div>
              <div>
                <p className={lightMode ? "text-slate-500" : "text-slate-400"}>Status</p>
                <p className="text-lg font-medium mt-0.5">
                  {coidaStatus.label}
                  {coidaStatus.days !== null && coidaStatus.days >= 0 && (
                    <span className={`block text-sm font-normal ${lightMode ? "text-slate-600" : "text-slate-300"}`}>
                      {coidaStatus.days} day{coidaStatus.days === 1 ? "" : "s"} remaining
                    </span>
                  )}
                </p>
              </div>
            </div>
            <p className={`mt-4 text-xs leading-relaxed ${lightMode ? "text-slate-600" : "text-slate-400"}`}>
              Note: Renewing a COIDA certificate can take <strong>5–15 working days</strong> depending on
              application accuracy and departmental workload. Start the process early when status turns yellow
              (50 days or less) so cover does not lapse.
            </p>
          </div>
        </section>

        {/* Risk Ranking */}
        <section id="risk" className="scroll-mt-32">
          <h2 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${lightMode ? "text-slate-900" : "text-slate-100"}`}>
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            Risk Ranking (Service + Roadworthy + Income Exposure)
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(showAllRisk ? risks : risks.slice(0, 6)).map((r) => {
              const v = vehicles.find((x) => x.id === r.vehicle_id);
              if (!v) return null;
              return (
                <div key={v.id} id={`risk-card-${v.id}`}>
                  <VehicleCard
                    vehicle={v}
                    riskScore={r.total_risk}
                    onSelect={(v) => { setSelectedContext("risk"); setSelected(v); }}
                    highlighted={selected?.id === v.id}
                    lightMode={lightMode}
                  />
                </div>
              );
            })}
          </div>
          {risks.length > 6 && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowAllRisk(!showAllRisk)}
                className={`inline-flex items-center justify-center gap-2 w-full sm:w-auto min-h-[44px] px-4 py-3 text-sm border rounded-lg transition ${theme.seeMore}`}
              >
                {showAllRisk ? (
                  <>
                    <ChevronUp className="w-5 h-5" /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-5 h-5" /> See more ({risks.length - 6} more)
                  </>
                )}
              </button>
            </div>
          )}
        </section>

        {/* Downtime & Reschedule helper */}
        {downVehicles.length > 0 && (
          <section className={`${lightMode ? "bg-red-50 border-red-200 text-slate-900" : "bg-slate-900 border-red-900/50 text-slate-100"} border rounded-xl p-5`}>
            <h2 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${lightMode ? "text-red-700" : "text-red-300"}`}>
              <CalendarClock className="w-5 h-5" />
              Vehicles Offline – Schedule Shuffle Needed
            </h2>
            <div className="space-y-3">
              {downVehicles.map((v) => (
                <div
                  key={v.id}
                  className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg ${
                    lightMode ? "bg-white border border-red-100" : "bg-slate-800/60"
                  }`}
                >
                  <div>
                    <p className="font-medium">
                      {v.plate} ({v.vehicle_id}) – {v.status}
                    </p>
                    <p className={`text-sm ${lightMode ? "text-slate-600" : "text-slate-400"}`}>
                      {v.notes || "No notes"}
                    </p>
                    <p className={`text-xs ${lightMode ? "text-red-600" : "text-red-300"}`}>
                      Income exposure: ~R{Number(v.estimated_daily_income).toLocaleString()}/day
                    </p>
                  </div>
                  <div className={`text-sm ${lightMode ? "text-slate-700" : "text-slate-300"}`}>
                    <p>Suggested: Reassign jobs to highest-availability active vehicles with similar capacity.</p>
                    <p className={`text-xs mt-1 ${lightMode ? "text-slate-500" : "text-slate-500"}`}>
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
        <section id="fuel" className="scroll-mt-32">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Fuel className="w-5 h-5 text-cyan-500" />
            Fuel Impact on Bulk Reserve
          </h2>

          {/* Mobile: stacked cards */}
          <div className="md:hidden space-y-3">
            {(showAllFuel ? fuelImpacts : fuelImpacts.slice(0, 6)).map((f) => (
              <div
                key={f.vehicle_id}
                className={`${theme.card} rounded-xl p-4 ${
                  selected?.id === f.vehicle_id ? "ring-2 ring-cyan-500" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    const v = vehicles.find((x) => x.id === f.vehicle_id);
                    if (v) {
                      setSelectedContext("fuel");
                      setSelected(v);
                    }
                  }}
                  className="font-mono text-lg text-cyan-500 hover:text-white hover:bg-cyan-600/30 hover:scale-105 active:scale-95 transition-all duration-150 rounded px-2 py-1 -ml-2 min-h-[44px]"
                  title="Open fuel analytics for this vehicle"
                >
                  {f.plate}
                </button>
                <div className={`mt-2 grid grid-cols-2 gap-2 text-sm ${theme.cardMuted}`}>
                  <span>{f.total_liters_used.toLocaleString()} L used</span>
                  <span>{f.percentage_of_reserve}% of reserve</span>
                  <span>Efficiency {f.efficiency_score}/100</span>
                  <span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium text-white ${
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
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left ${theme.cardMuted} border-b ${theme.tableBorder}`}>
                  <th className="py-2 pr-4">Vehicle</th>
                  <th className="py-2 pr-4">Litres Used</th>
                  <th className="py-2 pr-4">% of Reserve</th>
                  <th className="py-2 pr-4">Efficiency Score</th>
                  <th className="py-2">Impact Rating</th>
                </tr>
              </thead>
              <tbody>
                {(showAllFuel ? fuelImpacts : fuelImpacts.slice(0, 6)).map((f) => (
                  <tr
                    key={f.vehicle_id}
                    className={`border-b ${theme.rowBorder} ${
                      selected?.id === f.vehicle_id ? "bg-cyan-500/10" : ""
                    }`}
                  >
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        onClick={() => {
                          const v = vehicles.find((x) => x.id === f.vehicle_id);
                          if (v) {
                            setSelectedContext("fuel");
                            setSelected(v);
                          }
                        }}
                        className="font-mono text-cyan-500 hover:text-white hover:bg-cyan-600/30 hover:scale-105 active:scale-95 cursor-pointer transition-all duration-150 rounded px-1.5 py-0.5 -mx-1.5"
                        title="Open fuel analytics for this vehicle"
                      >
                        {f.plate}
                      </button>
                    </td>
                    <td className="py-2 pr-4">{f.total_liters_used.toLocaleString()} L</td>
                    <td className="py-2 pr-4">{f.percentage_of_reserve}%</td>
                    <td className="py-2 pr-4">{f.efficiency_score}/100</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium text-white ${
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

          {fuelImpacts.length > 6 && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowAllFuel(!showAllFuel)}
                className={`inline-flex items-center justify-center gap-2 w-full sm:w-auto min-h-[44px] px-4 py-3 text-sm border rounded-lg transition ${theme.seeMore}`}
              >
                {showAllFuel ? (
                  <>
                    <ChevronUp className="w-5 h-5" /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-5 h-5" /> See more ({fuelImpacts.length - 6} more)
                  </>
                )}
              </button>
            </div>
          )}
        </section>

        {/* Drivers – Schedules, Vehicles & Contact */}
        <section id="drivers" className="scroll-mt-32">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-500" />
            Drivers – Schedules, Assigned Vehicle & Contact
          </h2>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {(showAllDrivers ? drivers : drivers.slice(0, 6)).map((d) => {
              const assignedVehicle = vehicles.find((v) => v.assigned_driver_id === d.id);
              const driverSchedules = schedules
                .filter((s) => s.driver_id === d.id)
                .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
              const nextOrRecent = driverSchedules[0];
              const statusColor =
                d.status === "available"
                  ? "bg-emerald-600 text-white"
                  : d.status === "assigned"
                  ? "bg-cyan-600 text-white"
                  : "bg-slate-500 text-white";
              return (
                <div key={d.id} className={`${theme.card} rounded-xl p-4`}>
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openDriver(d)}
                      className="font-semibold text-base text-left text-cyan-500 hover:underline min-h-[44px]"
                    >
                      {d.name}
                    </button>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor}`}>
                      {d.status === "off" ? "Off day" : d.status}
                    </span>
                  </div>
                  <p className={`mt-2 text-sm font-mono ${theme.cardMuted}`}>
                    {assignedVehicle
                      ? `${assignedVehicle.plate} (${assignedVehicle.vehicle_id})`
                      : "No vehicle assigned"}
                  </p>
                  {d.phone ? (
                    <a
                      href={`tel:${d.phone}`}
                      className="mt-2 inline-flex items-center gap-2 min-h-[44px] text-cyan-600 font-medium"
                    >
                      <Phone className="w-4 h-4" />
                      {d.phone}
                    </a>
                  ) : (
                    <p className={`mt-2 text-sm ${theme.cardMuted}`}>No phone</p>
                  )}
                  <p className={`mt-1 text-xs ${theme.cardMuted}`}>
                    {nextOrRecent
                      ? `${nextOrRecent.job_description || "Job"} · ${new Date(
                          nextOrRecent.start_time
                        ).toLocaleDateString("en-ZA", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })} · ${nextOrRecent.status}`
                      : "No schedule"}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left ${theme.cardMuted} border-b ${theme.tableBorder}`}>
                  <th className="py-2 pr-4">Driver</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Assigned Vehicle</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2">Next / Recent Schedule</th>
                </tr>
              </thead>
              <tbody>
                {(showAllDrivers ? drivers : drivers.slice(0, 6)).map((d) => {
                  const assignedVehicle = vehicles.find((v) => v.assigned_driver_id === d.id);
                  const driverSchedules = schedules
                    .filter((s) => s.driver_id === d.id)
                    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
                  const nextOrRecent = driverSchedules[0];
                  const statusColor =
                    d.status === "available"
                      ? "bg-emerald-700 text-emerald-100"
                      : d.status === "assigned"
                      ? "bg-cyan-700 text-cyan-100"
                      : "bg-slate-600 text-slate-200";
                  return (
                    <tr key={d.id} className={`border-b ${theme.rowBorder}`}>
                      <td className="py-2.5 pr-4 font-medium">
                        <button
                          type="button"
                          onClick={() => openDriver(d)}
                          className="text-cyan-500 hover:underline text-left"
                        >
                          {d.name}
                        </button>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
                          {d.status === "off" ? "Off day" : d.status}
                        </span>
                      </td>
                      <td className={`py-2.5 pr-4 font-mono ${theme.cardMuted}`}>
                        {assignedVehicle
                          ? `${assignedVehicle.plate} (${assignedVehicle.vehicle_id})`
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        {d.phone ? (
                          <a
                            href={`tel:${d.phone}`}
                            className="inline-flex items-center gap-1 min-h-[44px] text-cyan-500"
                          >
                            <Phone className="w-3 h-3" />
                            {d.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`py-2.5 ${theme.cardMuted}`}>
                        {nextOrRecent ? (
                          <span>
                            {nextOrRecent.job_description || "Job"} ·{" "}
                            {new Date(nextOrRecent.start_time).toLocaleDateString("en-ZA", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            · {nextOrRecent.status}
                          </span>
                        ) : (
                          "No schedule"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {drivers.length > 6 && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowAllDrivers(!showAllDrivers)}
                className={`inline-flex items-center justify-center gap-2 w-full sm:w-auto min-h-[44px] px-4 py-3 text-sm border rounded-lg transition ${theme.seeMore}`}
              >
                {showAllDrivers ? (
                  <>
                    <ChevronUp className="w-5 h-5" /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-5 h-5" /> See more ({drivers.length - 6} more)
                  </>
                )}
              </button>
            </div>
          )}
        </section>

        {/* Document Scanner */}
        <section id="scan" className="scroll-mt-32 text-slate-100">
        <DocumentScanner
          onMatch={(v) => {
            setSelectedContext("other");
            setSelected(v);
            loadData();
          }}
        />
        </section>

        {/* AI Analytics */}
        <section className="bg-slate-900 border border-slate-700 rounded-xl p-5 text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-100">
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

        {selected && (() => {
          const assignedDriver = drivers.find((d) => d.id === selected.assigned_driver_id);
          const kmLeft = kmToNextService(selected);
          const statusColor =
            selected.status === "active"
              ? "text-emerald-500"
              : selected.status === "maintenance"
              ? "text-amber-500"
              : selected.status === "accident"
              ? "text-red-500"
              : theme.cardMuted;
          return (
            <>
              {/* Backdrop */}
              <div
                className={`sheet-backdrop fixed inset-0 bg-black/45 z-40 ${
                  sheetClosing ? "sheet-closing" : ""
                }`}
                onClick={closeSheet}
              />
              {/* Bottom sheet */}
              <div
                className={`sheet-panel fixed bottom-0 left-0 right-0 z-50 ${theme.popup} border-t rounded-t-2xl p-5 shadow-2xl max-h-[75vh] overflow-y-auto pb-8 ${
                  sheetClosing ? "sheet-closing" : ""
                }`}
                role="dialog"
                aria-modal="true"
                aria-label="Selected vehicle details"
              >
                <div className="mx-auto w-12 h-1.5 rounded-full bg-slate-500/40 mb-4" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-cyan-500 mb-1">Selected vehicle</p>
                    <p className="font-semibold text-xl">{selected.plate}</p>
                    <p className={`text-sm font-medium capitalize ${statusColor}`}>
                      {selected.status}
                    </p>
                  </div>
                  <button
                    onClick={closeSheet}
                    className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg ${theme.btn} transition-transform active:scale-95`}
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className={`mt-4 space-y-2 text-sm border-t ${theme.tableBorder} pt-4`}>
                  <p>
                    <span className={theme.cardMuted}>Registration / ID: </span>
                    {selected.vehicle_id} · {selected.make} {selected.model} ({selected.year})
                  </p>
                  <p>
                    <span className={theme.cardMuted}>Driver: </span>
                    {assignedDriver?.name || "Unassigned"}
                  </p>
                  <p>
                    <span className={theme.cardMuted}>Phone: </span>
                    {assignedDriver?.phone ? (
                      <a href={`tel:${assignedDriver.phone}`} className="text-cyan-500 font-medium">
                        {assignedDriver.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </p>
                  <p>
                    <span className={theme.cardMuted}>Km to next service: </span>
                    <span
                      className={
                        kmLeft < 500
                          ? "text-red-500 font-medium"
                          : kmLeft < 1000
                          ? "text-amber-500"
                          : ""
                      }
                    >
                      {Math.round(kmLeft).toLocaleString()} km
                    </span>
                  </p>
                  {(selected.current_fuel_level_pct != null || fuelAnalytics?.current_fuel_level_pct != null) && (
                    <p>
                      <span className={theme.cardMuted}>Current fuel level: </span>
                      <span className="text-cyan-500 font-medium">
                        {fuelAnalytics?.current_fuel_level_pct ?? selected.current_fuel_level_pct}%
                      </span>
                    </p>
                  )}
                </div>

                                {/* AI Service Analytics — only from Risk Ranking */}
                {selectedContext === "risk" && (
                <div className={`mt-4 rounded-xl border p-3 space-y-2 ${theme.tableBorder}`}>
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-amber-500" />
                    <p className="text-sm font-semibold">AI Service Analytics</p>
                  </div>
                  {loadingServiceAnalytics && (
                    <div className="flex items-center gap-2 text-xs text-amber-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Predicting next service from routes &amp; odometer…
                    </div>
                  )}
                  {!loadingServiceAnalytics && serviceAnalytics && (
                    <div className="space-y-2 text-xs">
                      <p className={theme.cardMuted}>{serviceAnalytics.summary}</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <span className={theme.cardMuted}>Current odo</span>
                        <span className="font-medium">
                          {Number(serviceAnalytics.current_odometer).toLocaleString()} km
                        </span>
                        <span className={theme.cardMuted}>Last service odo</span>
                        <span className="font-medium">
                          {serviceAnalytics.last_service_odometer != null
                            ? `${Number(serviceAnalytics.last_service_odometer).toLocaleString()} km`
                            : "—"}
                        </span>
                        <span className={theme.cardMuted}>Interval (AI/OEM)</span>
                        <span className="font-medium">
                          {Number(serviceAnalytics.service_interval_km).toLocaleString()} km
                        </span>
                        <span className={theme.cardMuted}>Km to service</span>
                        <span
                          className={`font-medium ${
                            serviceAnalytics.km_to_next_service < 500
                              ? "text-red-500"
                              : serviceAnalytics.km_to_next_service < 1000
                              ? "text-amber-500"
                              : ""
                          }`}
                        >
                          {serviceAnalytics.km_to_next_service.toLocaleString()} km
                        </span>
                        <span className={theme.cardMuted}>Avg daily km</span>
                        <span className="font-medium">
                          ~{serviceAnalytics.avg_daily_km_estimate} km
                          <span className="text-[10px] opacity-70">
                            {" "}
                            ({serviceAnalytics.daily_km_source === "schedules" ? "routes" : "default"})
                          </span>
                        </span>
                        <span className={theme.cardMuted}>Predicted service</span>
                        <span className="font-medium text-amber-500">
                          {serviceAnalytics.predicted_next_service_date || "—"}
                          {serviceAnalytics.days_until_service_estimate != null
                            ? ` (~${serviceAnalytics.days_until_service_estimate}d)`
                            : ""}
                        </span>
                        <span className={theme.cardMuted}>Urgency</span>
                        <span className="font-medium capitalize">{serviceAnalytics.urgency}</span>
                      </div>
                      {Array.isArray(serviceAnalytics.recommendations) && (
                        <ul className="list-disc list-inside space-y-0.5 text-slate-400 pt-1">
                          {serviceAnalytics.recommendations.map((r: string, i: number) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {!loadingServiceAnalytics && !serviceAnalytics && (
                    <p className={`text-xs ${theme.cardMuted}`}>
                      Scan a service job card or ensure schedules exist to refine the next service date.
                    </p>
                  )}
                </div>
                )}

                {/* AI Fuel Analytics — only from Fuel Impact */}
                {selectedContext === "fuel" && (
                <div className={`mt-4 rounded-xl border p-3 space-y-2 ${theme.tableBorder}`}>
                  <div className="flex items-center gap-2">
                    <Fuel className="w-4 h-4 text-cyan-500" />
                    <p className="text-sm font-semibold">AI Fuel Analytics</p>
                  </div>
                  {loadingFuelAnalytics && (
                    <div className="flex items-center gap-2 text-xs text-cyan-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Comparing refuel history vs model average…
                    </div>
                  )}
                  {!loadingFuelAnalytics && fuelAnalytics && (
                    <div className="space-y-2 text-xs">
                      <p className={theme.cardMuted}>{fuelAnalytics.summary}</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <span className={theme.cardMuted}>Refuels logged</span>
                        <span className="font-medium">{fuelAnalytics.refuel_count}</span>
                        <span className={theme.cardMuted}>Total litres</span>
                        <span className="font-medium">{fuelAnalytics.total_liters_refueled} L</span>
                        <span className={theme.cardMuted}>Avg per fill</span>
                        <span className="font-medium">
                          {fuelAnalytics.avg_liters_per_refuel != null
                            ? `${fuelAnalytics.avg_liters_per_refuel} L`
                            : "—"}
                        </span>
                        <span className={theme.cardMuted}>Days between fills</span>
                        <span className="font-medium">
                          {fuelAnalytics.days_between_refuels_avg != null
                            ? fuelAnalytics.days_between_refuels_avg
                            : "—"}
                        </span>
                        <span className={theme.cardMuted}>AI model avg</span>
                        <span className="font-medium text-cyan-500">
                          {fuelAnalytics.researched_avg_l_per_100km != null
                            ? `${fuelAnalytics.researched_avg_l_per_100km} L/100km`
                            : "—"}
                        </span>
                        <span className={theme.cardMuted}>Fleet recorded</span>
                        <span className="font-medium">
                          {fuelAnalytics.fleet_recorded_efficiency != null
                            ? `${fuelAnalytics.fleet_recorded_efficiency} L/100km`
                            : "—"}
                        </span>
                        <span className={theme.cardMuted}>vs expected</span>
                        <span
                          className={`font-medium capitalize ${
                            fuelAnalytics.consumption_vs_expected === "worse"
                              ? "text-red-500"
                              : fuelAnalytics.consumption_vs_expected === "better"
                              ? "text-emerald-500"
                              : ""
                          }`}
                        >
                          {fuelAnalytics.consumption_vs_expected}
                          {fuelAnalytics.consumption_delta_pct != null
                            ? ` (${fuelAnalytics.consumption_delta_pct > 0 ? "+" : ""}${fuelAnalytics.consumption_delta_pct}%)`
                            : ""}
                        </span>
                        <span className={theme.cardMuted}>Reserve impact</span>
                        <span className="font-medium capitalize">{fuelAnalytics.impact_on_reserve}</span>
                      </div>
                      {Array.isArray(fuelAnalytics.recommendations) &&
                        fuelAnalytics.recommendations.length > 0 && (
                          <ul className="list-disc list-inside space-y-0.5 text-slate-400 pt-1">
                            {fuelAnalytics.recommendations.map((r: string, i: number) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        )}
                      {fuelAnalytics.last_fill_price_check && (
                        <div
                          className={`mt-2 p-2 rounded-lg border text-[11px] ${
                            fuelAnalytics.last_fill_price_check.match_status === "match"
                              ? "border-emerald-600/50 bg-emerald-500/5"
                              : "border-amber-600/50 bg-amber-500/5"
                          }`}
                        >
                          <p className="font-medium mb-0.5">Last fill · price check</p>
                          <p className={theme.cardMuted}>
                            {fuelAnalytics.last_fill_price_check.message}
                          </p>
                          <p className="mt-1 font-mono">
                            Slip {fuelAnalytics.last_fill_price_check.slip_liters} L · expected{" "}
                            {fuelAnalytics.last_fill_price_check.expected_liters_from_cost} L @ R
                            {fuelAnalytics.last_fill_price_check.researched_price_per_litre}/L · implied R
                            {fuelAnalytics.last_fill_price_check.implied_price_per_litre}/L
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {!loadingFuelAnalytics && !fuelAnalytics && (
                    <p className={`text-xs ${theme.cardMuted}`}>
                      Scan fuel slips for this plate to unlock consumption trends and model comparison.
                    </p>
                  )}
                </div>
                )}

                <button
                  onClick={closeSheet}
                  className="mt-5 w-full min-h-[48px] rounded-xl bg-cyan-600 hover:bg-cyan-500 active:scale-[0.98] transition-transform text-white font-medium"
                >
                  Close
                </button>
              </div>
            </>
          );
        })()}
      </main>


        {selectedDriver && (() => {
          const d = selectedDriver;
          const assignedVehicle = vehicles.find((v) => v.assigned_driver_id === d.id);
          const driverSchedules = schedules
            .filter((s) => s.driver_id === d.id)
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
          const vehicleSchedules = assignedVehicle
            ? schedules
                .filter((s) => s.vehicle_id === assignedVehicle.id)
                .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
            : [];
          // Merge unique by id for "related to this driver or their vehicle"
          const byId = new Map<string, Schedule>();
          [...driverSchedules, ...vehicleSchedules].forEach((s) => byId.set(s.id, s));
          const allRelated = Array.from(byId.values()).sort(
            (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
          );
          const upcoming = allRelated.filter((s) => new Date(s.start_time).getTime() >= Date.now() - 3600000);
          const past = allRelated.filter((s) => new Date(s.start_time).getTime() < Date.now() - 3600000).reverse();

          return (
            <>
              <div
                className={`sheet-backdrop fixed inset-0 bg-black/45 z-40 ${
                  driverSheetClosing ? "sheet-closing" : ""
                }`}
                onClick={closeDriverSheet}
              />
              <div
                className={`sheet-panel fixed bottom-0 left-0 right-0 z-50 ${theme.popup} border-t rounded-t-2xl p-5 shadow-2xl max-h-[75vh] overflow-y-auto pb-8 ${
                  driverSheetClosing ? "sheet-closing" : ""
                }`}
                role="dialog"
                aria-modal="true"
                aria-label="Driver schedule details"
              >
                <div className="mx-auto w-12 h-1.5 rounded-full bg-slate-500/40 mb-4" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-violet-500 mb-1">Driver</p>
                    <p className="font-semibold text-xl">{d.name}</p>
                    <p className={`text-sm capitalize ${theme.cardMuted}`}>
                      {d.status === "off" ? "Off day" : d.status}
                      {d.license_number ? ` · Lic ${d.license_number}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={closeDriverSheet}
                    className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg ${theme.btn} transition-transform active:scale-95`}
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className={`mt-4 space-y-2 text-sm border-t ${theme.tableBorder} pt-4`}>
                  <p>
                    <span className={theme.cardMuted}>Phone: </span>
                    {d.phone ? (
                      <a href={`tel:${d.phone}`} className="text-cyan-500 font-medium">
                        {d.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </p>
                  <p>
                    <span className={theme.cardMuted}>Assigned vehicle: </span>
                    {assignedVehicle ? (
                      <button
                        type="button"
                        className="text-cyan-500 font-medium"
                        onClick={() => {
                          setSelectedDriver(null);
                          setSelectedContext("risk");
                          setSelected(assignedVehicle);
                        }}
                      >
                        {assignedVehicle.plate} · {assignedVehicle.vehicle_id} · {assignedVehicle.make}{" "}
                        {assignedVehicle.model}
                      </button>
                    ) : (
                      "None assigned"
                    )}
                  </p>
                </div>

                <div className={`mt-4 rounded-xl border p-3 space-y-2 ${theme.tableBorder}`}>
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-violet-500" />
                    Driver schedule
                  </p>
                  {driverSchedules.length === 0 ? (
                    <p className={`text-xs ${theme.cardMuted}`}>No jobs scheduled for this driver.</p>
                  ) : (
                    <ul className="space-y-2 text-xs">
                      {driverSchedules.map((s) => {
                        const veh = vehicles.find((v) => v.id === s.vehicle_id);
                        return (
                          <li
                            key={s.id}
                            className={`p-2 rounded-lg border ${theme.tableBorder}`}
                          >
                            <p className="font-medium">
                              {s.job_description || "Job"} ·{" "}
                              <span className="capitalize">{s.status}</span>
                            </p>
                            <p className={theme.cardMuted}>
                              {new Date(s.start_time).toLocaleString("en-ZA", {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {s.end_time
                                ? ` → ${new Date(s.end_time).toLocaleTimeString("en-ZA", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}`
                                : ""}
                            </p>
                            <p className={theme.cardMuted}>
                              Vehicle: {veh ? `${veh.plate} (${veh.vehicle_id})` : s.vehicle_id}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {assignedVehicle && (
                  <div className={`mt-3 rounded-xl border p-3 space-y-2 ${theme.tableBorder}`}>
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <CalendarClock className="w-4 h-4 text-cyan-500" />
                      Vehicle schedule ({assignedVehicle.plate})
                    </p>
                    {vehicleSchedules.length === 0 ? (
                      <p className={`text-xs ${theme.cardMuted}`}>No jobs on this vehicle&apos;s calendar.</p>
                    ) : (
                      <ul className="space-y-2 text-xs">
                        {vehicleSchedules.map((s) => {
                          const drv = drivers.find((x) => x.id === s.driver_id);
                          return (
                            <li
                              key={`v-${s.id}`}
                              className={`p-2 rounded-lg border ${theme.tableBorder}`}
                            >
                              <p className="font-medium">
                                {s.job_description || "Job"} ·{" "}
                                <span className="capitalize">{s.status}</span>
                              </p>
                              <p className={theme.cardMuted}>
                                {new Date(s.start_time).toLocaleString("en-ZA", {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                              <p className={theme.cardMuted}>
                                Driver on job: {drv?.name || "Unassigned"}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                <button
                  onClick={closeDriverSheet}
                  className="mt-5 w-full min-h-[48px] rounded-xl bg-violet-600 hover:bg-violet-500 active:scale-[0.98] transition-transform text-white font-medium"
                >
                  Close
                </button>
              </div>
            </>
          );
        })()}

      {/* Bottom navigation – mobile first */}
      <nav className={`fixed bottom-0 left-0 right-0 z-30 ${theme.nav} safe-area-pb`}>
        <div className="max-w-7xl mx-auto grid grid-cols-5 gap-1 px-1 py-1">
          {[
            { id: "overview", label: "Home", icon: LayoutDashboard },
            { id: "risk", label: "Risk", icon: AlertTriangle },
            { id: "fuel", label: "Fuel", icon: Fuel },
            { id: "drivers", label: "Drivers", icon: Users },
            { id: "scan", label: "Scan", icon: Camera },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] rounded-lg text-[10px] sm:text-xs font-medium transition ${
                  active ? theme.navActive : theme.navIdle
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}