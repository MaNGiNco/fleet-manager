"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Vehicle, RiskScore, FuelImpact, Driver, Schedule } from "@/types";
import { calculateRiskScores, calculateFuelImpacts, kmToNextService, daysUntil, formatDate } from "@/lib/utils";
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
  Search,
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
  const [showAllSchedules, setShowAllSchedules] = useState(false);
  const [applyingRecs, setApplyingRecs] = useState<"clash" | "heavy_day" | null>(null);
  const [applyRecMsg, setApplyRecMsg] = useState<string | null>(null);
  const [showRoadworthyPopup, setShowRoadworthyPopup] = useState(false);
  const [showFuelReserveModal, setShowFuelReserveModal] = useState(false);
  const [fuelReserveMode, setFuelReserveMode] = useState<"tank" | "budget">("tank");
  const [fuelReserveLitersInput, setFuelReserveLitersInput] = useState("");
  const [fuelBudgetInput, setFuelBudgetInput] = useState("");
  const [fuelReserveMsg, setFuelReserveMsg] = useState<string | null>(null);
  const [savingFuelReserve, setSavingFuelReserve] = useState(false);
  const [fuelReserveMeta, setFuelReserveMeta] = useState<{
    mode?: string;
    budget_zar?: number | null;
    remaining_budget_zar?: number | null;
    capacity_liters?: number | null;
  }>({});
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
  const [showSearchPopup, setShowSearchPopup] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<
    | { type: "vehicle"; vehicle: Vehicle }
    | { type: "driver"; driver: Driver }
    | null
  >(null);
  const [searchFuelAnalytics, setSearchFuelAnalytics] = useState<any>(null);
  const [searchServiceAnalytics, setSearchServiceAnalytics] = useState<any>(null);
  const [loadingSearchAnalytics, setLoadingSearchAnalytics] = useState(false);

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

  const saveFuelReserve = async () => {
    setSavingFuelReserve(true);
    setFuelReserveMsg(null);
    try {
      const body =
        fuelReserveMode === "budget"
          ? { mode: "budget", budget_zar: Number(fuelBudgetInput) }
          : { mode: "tank", current_liters: Number(fuelReserveLitersInput) };
      const res = await fetch("/api/fuel-reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      if (data.reserve) {
        setFuelReserve(Number(data.reserve.current_liters) || 0);
        setFuelReserveMeta({
          mode: data.reserve.mode,
          budget_zar: data.reserve.budget_zar,
          remaining_budget_zar: data.reserve.remaining_budget_zar,
          capacity_liters: data.reserve.capacity_liters,
        });
      }
      const liters = Number(data.reserve?.current_liters ?? data.expected_liters ?? 0);
      setFuelReserveMsg(
        data.message ||
          (fuelReserveMode === "budget"
            ? `Budget set → ${liters.toLocaleString()} L available @ R${data.researched_price_per_litre}/L`
            : `Bulk tank updated → ${liters.toLocaleString()} L`)
      );
      await loadData();
    } catch (e: any) {
      setFuelReserveMsg(e.message || "Could not update reserve");
    } finally {
      setSavingFuelReserve(false);
    }
  };

  const openSchedulesView = () => {
    setShowSchedulesView(true);
    setShowAllSchedules(false);
    setApplyRecMsg(null);
    loadScheduleAnalytics();
    loadData();
  };

  const openSearchPopup = () => {
    setShowSearchPopup(true);
    setSearchQuery("");
    setSearchResult(null);
    setSearchFuelAnalytics(null);
    setSearchServiceAnalytics(null);
  };

  /** Province-agnostic plate compare for local search (mirrors scan matching) */
  const plateSearchKey = (plate: string | null | undefined) => {
    const raw = (plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const regions = ["KZN", "CA", "GP", "WC", "EC", "FS", "MP", "NW", "LP", "NC"];
    for (const code of regions) {
      if (raw.startsWith(code) && raw.length > code.length + 2) return raw.slice(code.length);
      if (raw.endsWith(code) && raw.length > code.length + 2) return raw.slice(0, -code.length);
    }
    return raw;
  };

  const searchHits = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.length < 1) return { vehicles: [] as Vehicle[], drivers: [] as Driver[] };
    const qPlate = plateSearchKey(searchQuery);
    const vehicleHits = vehicles
      .filter((v) => {
        const plate = (v.plate || "").toLowerCase();
        const plateKey = plateSearchKey(v.plate);
        const make = (v.make || "").toLowerCase();
        const model = (v.model || "").toLowerCase();
        const vid = (v.vehicle_id || "").toLowerCase();
        const makeModel = `${make} ${model}`;
        return (
          plate.includes(q) ||
          (qPlate.length >= 3 && (plateKey.includes(qPlate) || qPlate.includes(plateKey))) ||
          make.includes(q) ||
          model.includes(q) ||
          makeModel.includes(q) ||
          vid.includes(q)
        );
      })
      .slice(0, 12);
    const driverHits = drivers
      .filter((d) => {
        const name = (d.name || "").toLowerCase();
        const lic = (d.license_number || "").toLowerCase();
        const phone = (d.phone || "").toLowerCase();
        return name.includes(q) || lic.includes(q) || phone.includes(q);
      })
      .slice(0, 12);
    return { vehicles: vehicleHits, drivers: driverHits };
  })();

  const selectSearchVehicle = async (v: Vehicle) => {
    setSearchResult({ type: "vehicle", vehicle: v });
    setSearchFuelAnalytics(null);
    setSearchServiceAnalytics(null);
    setLoadingSearchAnalytics(true);
    try {
      const [fuelRes, svcRes] = await Promise.all([
        fetch("/api/fuel-analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicleId: v.id }),
        }).then((r) => r.json().catch(() => ({}))),
        fetch("/api/service-analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicleId: v.id }),
        }).then((r) => r.json().catch(() => ({}))),
      ]);
      setSearchFuelAnalytics(fuelRes?.analytics || null);
      setSearchServiceAnalytics(svcRes?.analytics || null);
    } catch {
      /* offline / demo — panels stay empty */
    } finally {
      setLoadingSearchAnalytics(false);
    }
  };

  const selectSearchDriver = (d: Driver) => {
    setSearchResult({ type: "driver", driver: d });
    setSearchFuelAnalytics(null);
    setSearchServiceAnalytics(null);
  };

  const applyScheduleRecommendations = async (kind: "clash" | "heavy_day") => {
    if (!scheduleAnalytics) return;
    const recs =
      kind === "clash"
        ? scheduleAnalytics.clash_recommendations || []
        : (scheduleAnalytics.heavy_day_recommendations || []).filter(
            (r: any) => r.schedule_id && r.proposed_start
          );
    if (!recs.length) {
      setApplyRecMsg(`No ${kind === "clash" ? "clash" : "heavy-day"} recommendations to apply.`);
      return;
    }
    setApplyingRecs(kind);
    setApplyRecMsg(null);
    try {
      const res = await fetch("/api/apply-schedule-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, recommendations: recs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");
      setApplyRecMsg(data.message || `Applied ${data.applied} change(s).`);
      await loadScheduleAnalytics();
      await loadData();
    } catch (e: any) {
      setApplyRecMsg(e.message || "Failed to apply recommendations");
    } finally {
      setApplyingRecs(null);
    }
  };

  const sortedScheduleList = () => {
    const list = [...(scheduleAnalytics?.schedules || schedules)];
    const rank = (status: string) => {
      const s = String(status || "").toLowerCase();
      if (s === "in_progress") return 0;
      if (s === "scheduled") return 1;
      if (s === "delivered") return 2;
      if (s === "completed") return 3;
      if (s === "failed") return 4;
      if (s === "cancelled") return 5;
      return 6;
    };
    return list.sort((a: any, b: any) => {
      const sr = rank(a.status) - rank(b.status);
      if (sr !== 0) return sr;
      return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
    });
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

        const { data: reserve } = await supabase
          .from("fuel_reserve")
          .select("current_liters, capacity_liters, budget_zar, remaining_budget_zar, mode")
          .limit(1)
          .maybeSingle();
        if (reserve) {
          setFuelReserve(Number(reserve.current_liters) || 0);
          setFuelReserveMeta({
            mode: reserve.mode || "tank",
            budget_zar: reserve.budget_zar,
            remaining_budget_zar: reserve.remaining_budget_zar,
            capacity_liters: reserve.capacity_liters,
          });
          if (reserve.mode === "budget") setFuelReserveMode("budget");
        }

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
          { id: "s1", vehicle_id: "1", driver_id: "d1", start_time: new Date(now + 2*hr).toISOString(), end_time: new Date(now + 6*hr).toISOString(), job_description: "150km delivery Gauteng", status: "scheduled", location: "Gauteng", job_type: "delivery", created_at: new Date().toISOString() },
          { id: "s2", vehicle_id: "1", driver_id: "d1", start_time: new Date(now - 24*hr).toISOString(), end_time: new Date(now - 20*hr).toISOString(), job_description: "80km local runs", status: "completed", location: "Local", job_type: "shuttle", created_at: new Date().toISOString() },
          { id: "s3", vehicle_id: "3", driver_id: "d2", start_time: new Date(now + 5*hr).toISOString(), end_time: new Date(now + 10*hr).toISOString(), job_description: "220km Cape corridor", status: "scheduled", location: "Cape corridor", job_type: "delivery", created_at: new Date().toISOString() },
          { id: "s4", vehicle_id: "3", driver_id: "d2", start_time: new Date(now + 28*hr).toISOString(), end_time: new Date(now + 34*hr).toISOString(), job_description: "120km depot shuttle", status: "scheduled", location: "Depot", job_type: "shuttle", created_at: new Date().toISOString() },
          { id: "s5", vehicle_id: "5", driver_id: "d4", start_time: new Date(now + 3*hr).toISOString(), end_time: new Date(now + 8*hr).toISOString(), job_description: "95km client collection", status: "scheduled", location: "Client site", job_type: "collection", created_at: new Date().toISOString() },
          { id: "s6", vehicle_id: "4", driver_id: "d6", start_time: new Date(now - 5*hr).toISOString(), end_time: new Date(now - 1*hr).toISOString(), job_description: "60km urban drops", status: "completed", location: "Urban", job_type: "delivery", created_at: new Date().toISOString() },
          { id: "s7", vehicle_id: "1", driver_id: "d8", start_time: new Date(now + 48*hr).toISOString(), end_time: new Date(now + 54*hr).toISOString(), job_description: "180km inter-depot", status: "scheduled", location: "Inter-depot", job_type: "shuttle", created_at: new Date().toISOString() },
          { id: "s8", vehicle_id: "3", driver_id: "d9", start_time: new Date(now + 12*hr).toISOString(), end_time: new Date(now + 16*hr).toISOString(), job_description: "110km site inspection", status: "scheduled", location: "Site", job_type: "inspection", created_at: new Date().toISOString() },
          { id: "s9", vehicle_id: "5", driver_id: "d11", start_time: new Date(now + 30*hr).toISOString(), end_time: new Date(now + 36*hr).toISOString(), job_description: "140km bulk drop", status: "scheduled", location: "Bulk yard", job_type: "delivery", created_at: new Date().toISOString() },
          { id: "s10", vehicle_id: "1", driver_id: "d1", start_time: new Date(now + 3*hr).toISOString(), end_time: new Date(now + 7*hr).toISOString(), job_description: "Overlapping test run", status: "scheduled", location: "Gauteng", job_type: "delivery", created_at: new Date().toISOString() },
          { id: "s11", vehicle_id: "3", driver_id: "d2", start_time: new Date(now + 5.5*hr).toISOString(), end_time: new Date(now + 9*hr).toISOString(), job_description: "Heavy-day near overlap", status: "in_progress", location: "Cape", job_type: "collection", created_at: new Date().toISOString() },
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
        header:
          "border-b border-slate-200/90 bg-white/90 backdrop-blur-xl sticky top-0 z-20 shadow-sm",
        muted: "text-slate-500",
        card: "bg-white border border-slate-200/90 shadow-sm",
        cardMuted: "text-slate-500",
        tableBorder: "border-slate-200",
        rowBorder: "border-slate-100",
        btn: "bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200",
        seeMore:
          "bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 rounded-xl",
        nav: "bg-white/95 backdrop-blur-xl border-t border-slate-200/90 shadow-[0_-4px_24px_-8px_rgba(0,0,0,0.08)]",
        navActive: "text-cyan-600",
        navIdle: "text-slate-500",
        summary: "bg-slate-50 border-b border-slate-200 text-slate-700",
        error: "bg-rose-50 border-rose-200 text-rose-800",
        popup: "bg-white border-slate-200 text-slate-900 shadow-2xl",
      }
    : {
        page: "min-h-screen bg-[#070B14] text-slate-100 pb-24 ops-grid-bg",
        header:
          "border-b border-[#1E2A3F]/90 bg-[#0D1320]/85 backdrop-blur-xl sticky top-0 z-20",
        muted: "text-slate-400",
        card: "bg-[#0D1320] border border-[#1E2A3F] shadow-ops-sm",
        cardMuted: "text-slate-400",
        tableBorder: "border-[#1E2A3F]",
        rowBorder: "border-slate-800/80",
        btn: "bg-slate-800/70 hover:bg-slate-700/90 text-slate-100 border border-slate-700/60",
        seeMore:
          "bg-slate-800/60 hover:bg-slate-700/80 border-[#1E2A3F] text-slate-100 rounded-xl",
        nav: "bg-[#0D1320]/95 backdrop-blur-xl border-t border-[#1E2A3F]/90 shadow-[0_-8px_32px_-12px_rgba(0,0,0,0.5)]",
        navActive: "text-cyan-400",
        navIdle: "text-slate-500",
        summary: "bg-[#0D1320]/90 border-b border-[#1E2A3F] text-slate-300",
        error: "bg-rose-950/70 border-rose-700/60 text-rose-100",
        popup: "bg-[#121A2B] border-cyan-500/40 text-slate-100 shadow-ops-lg",
      };

  return (
    <div className={theme.page}>
      {/* Header — Command bar */}
      <header className={theme.header}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 shadow-glow-cyan">
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-50 truncate">
                Fleet Manager
              </h1>
              <p className={`text-[11px] sm:text-xs tracking-wide ${theme.muted}`}>
                Operate · Downtime · Compliance · Fuel
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {usingDemo && (
              <span className="hidden sm:inline-flex text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full">
                Demo
              </span>
            )}
            <button
              onClick={openSearchPopup}
              className={`ops-btn ${showSearchPopup ? "ring-2 ring-cyan-500/70 border-cyan-500/50" : ""}`}
              title="Search vehicles, plates, makes & drivers"
              aria-label="Search"
            >
              <Search className="w-5 h-5 text-cyan-400" />
            </button>
            <button
              onClick={openSchedulesView}
              className={`ops-btn ${showSchedulesView ? "ring-2 ring-violet-500/70 border-violet-500/50" : ""}`}
              title="Schedules — vehicles, drivers & AI clash analysis"
              aria-label="Schedules"
            >
              <CalendarClock className="w-5 h-5 text-violet-400" />
            </button>
            <button
              onClick={() => setLightMode(!lightMode)}
              className="ops-btn"
              title={lightMode ? "Dark mode" : "Light mode (outdoor)"}
              aria-label="Toggle theme"
            >
              {lightMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="ops-btn disabled:opacity-50"
              title="Refresh"
              aria-label="Refresh data"
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

            <div className="flex-1 overflow-y-auto hide-scrollbar p-4 space-y-4 pb-24">
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
                        <p className="text-xs font-medium text-emerald-500">Optimisations overview</p>
                        <ul className="list-disc list-inside text-xs space-y-0.5">
                          {scheduleAnalytics.optimisations.map((o: string, i: number) => (
                            <li key={i} className={theme.cardMuted}>
                              {o}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Clash recommendations — separate apply */}
                    <div className={`rounded-lg border p-3 space-y-2 ${theme.tableBorder}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-red-500">
                          Clash recommendations ({scheduleAnalytics.clash_recommendations?.length || 0})
                        </p>
                        <button
                          type="button"
                          disabled={
                            applyingRecs !== null ||
                            !(scheduleAnalytics.clash_recommendations?.length > 0)
                          }
                          onClick={() => applyScheduleRecommendations("clash")}
                          className="min-h-[40px] px-3 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white"
                        >
                          {applyingRecs === "clash" ? "Applying…" : "Apply clash recommendations"}
                        </button>
                      </div>
                      {(scheduleAnalytics.clash_recommendations || []).length === 0 ? (
                        <p className={`text-xs ${theme.cardMuted}`}>No clash shifts proposed.</p>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {(scheduleAnalytics.clash_recommendations || []).map((r: any, i: number) => (
                            <li key={i} className={theme.cardMuted}>
                              · {r.summary}
                              {r.proposed_start
                                ? ` → ${new Date(r.proposed_start).toLocaleString("en-ZA", {
                                    day: "numeric",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Heavy day recommendations — separate apply */}
                    <div className={`rounded-lg border p-3 space-y-2 ${theme.tableBorder}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-amber-500">
                          Heavy-day recommendations (
                          {(scheduleAnalytics.heavy_day_recommendations || []).filter(
                            (r: any) => r.schedule_id
                          ).length || 0}
                          )
                        </p>
                        <button
                          type="button"
                          disabled={
                            applyingRecs !== null ||
                            !(scheduleAnalytics.heavy_day_recommendations || []).some(
                              (r: any) => r.schedule_id && r.proposed_start
                            )
                          }
                          onClick={() => applyScheduleRecommendations("heavy_day")}
                          className="min-h-[40px] px-3 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white"
                        >
                          {applyingRecs === "heavy_day" ? "Applying…" : "Apply heavy-day recommendations"}
                        </button>
                      </div>
                      {(scheduleAnalytics.heavy_day_recommendations || []).length === 0 ? (
                        <p className={`text-xs ${theme.cardMuted}`}>No heavy-day staggers proposed.</p>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {(scheduleAnalytics.heavy_day_recommendations || []).map((r: any, i: number) => (
                            <li key={i} className={theme.cardMuted}>
                              · {r.summary}
                              {r.proposed_start
                                ? ` → ${new Date(r.proposed_start).toLocaleString("en-ZA", {
                                    day: "numeric",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {applyRecMsg && (
                      <p className="text-xs text-cyan-500 font-medium">{applyRecMsg}</p>
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
                    {(() => {
                      const full = sortedScheduleList();
                      const visible = showAllSchedules ? full : full.slice(0, 6);
                      if (full.length === 0) {
                        return (
                          <tr>
                            <td colSpan={5} className={`py-6 text-center ${theme.cardMuted}`}>
                              No schedules yet — scan a dispatch / trip sheet to add jobs.
                            </td>
                          </tr>
                        );
                      }
                      return visible.map((s: any) => {
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
                      });
                    })()}
                  </tbody>
                </table>
                {sortedScheduleList().length > 6 && (
                  <div className="p-3 text-center border-t border-inherit">
                    <button
                      type="button"
                      onClick={() => setShowAllSchedules(!showAllSchedules)}
                      className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 text-sm border rounded-lg ${theme.seeMore}`}
                    >
                      {showAllSchedules ? (
                        <>
                          <ChevronUp className="w-4 h-4" /> Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" /> See more ({sortedScheduleList().length - 6} more)
                        </>
                      )}
                    </button>
                  </div>
                )}
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
        {/* KPI strip — highest scan priority */}
        <section
          id="overview"
          className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 scroll-mt-28"
        >
          <button
            type="button"
            onClick={() => {
              setShowAllRisk(true);
              scrollToSection("risk");
            }}
            className={`ops-kpi ${theme.card} group`}
            title="Show all vehicles in risk ranking"
          >
            <p className="ops-label">Fleet size</p>
            <p className="ops-value mt-1 group-hover:text-cyan-300 transition-colors">
              {vehicles.length}
            </p>
            <p className={`text-[11px] mt-1 ${theme.cardMuted}`}>Active units</p>
          </button>
          <button
            type="button"
            onClick={() => {
              if (downVehicles.length > 0) scrollToSection("downtime");
              else {
                setShowAllRisk(true);
                scrollToSection("risk");
              }
            }}
            className={`ops-kpi ${theme.card} group relative overflow-hidden`}
            title="View offline / down vehicles"
          >
            {downVehicles.length > 0 && (
              <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-rose-500 animate-pulse-soft shadow-glow-rose" />
            )}
            <p className="ops-label">Down / offline</p>
            <p className="ops-value mt-1 text-rose-400 tabular-nums">
              {downVehicles.length}
            </p>
            <p className={`text-[11px] mt-1 ${theme.cardMuted}`}>Needs shuffle</p>
          </button>
          <button
            type="button"
            onClick={() => setShowRoadworthyPopup(true)}
            className={`ops-kpi ${theme.card} group`}
            title="Vehicles with roadworthy expiring within 20 days"
          >
            <p className="ops-label">Roadworthy ≤20d</p>
            <p className="ops-value mt-1 text-amber-400 tabular-nums">
              {certAlerts.length}
            </p>
            <p className={`text-[11px] mt-1 ${theme.cardMuted}`}>Certificate alerts</p>
          </button>
          <button
            type="button"
            onClick={() => {
              setFuelReserveLitersInput(String(fuelReserve || ""));
              setFuelBudgetInput(
                fuelReserveMeta.remaining_budget_zar != null
                  ? String(fuelReserveMeta.remaining_budget_zar)
                  : fuelReserveMeta.budget_zar != null
                  ? String(fuelReserveMeta.budget_zar)
                  : ""
              );
              setFuelReserveMode(
                fuelReserveMeta.mode === "budget" ? "budget" : "tank"
              );
              setFuelReserveMsg(null);
              setShowFuelReserveModal(true);
            }}
            className={`ops-kpi ${theme.card} group`}
            title="Update bulk fuel reserve or budget"
          >
            <p className="ops-label">Fuel reserve</p>
            <p className="ops-value mt-1 text-cyan-400 tabular-nums">
              {Number(fuelReserve || 0).toLocaleString()}
              <span className="text-base font-semibold text-cyan-500/80 ml-1">L</span>
            </p>
            {fuelReserveMeta.mode === "budget" &&
              (fuelReserveMeta.remaining_budget_zar != null ||
                fuelReserveMeta.budget_zar != null) && (
                <p className={`text-[11px] mt-1 ${theme.cardMuted}`}>
                  R
                  {Number(
                    fuelReserveMeta.remaining_budget_zar ??
                      fuelReserveMeta.budget_zar ??
                      0
                  ).toLocaleString()}{" "}
                  remaining
                </p>
              )}
          </button>
        </section>

        {/* Company COIDA (business-level, not per vehicle) */}
        <section id="coida" className="scroll-mt-28">
          <div
            className={`rounded-2xl border p-4 sm:p-5 ${
              coidaStatus.color === "red"
                ? lightMode
                  ? "bg-rose-50 border-rose-200 text-slate-900"
                  : "bg-rose-950/35 border-rose-500/40 text-slate-100 shadow-glow-rose"
                : coidaStatus.color === "yellow"
                ? lightMode
                  ? "bg-amber-50 border-amber-200 text-slate-900"
                  : "bg-amber-950/25 border-amber-500/35 text-slate-100 shadow-glow-amber"
                : lightMode
                ? "bg-emerald-50 border-emerald-200 text-slate-900"
                : "bg-emerald-950/25 border-emerald-500/30 text-slate-100"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="ops-section-title">
                  Company COIDA certificate
                </h2>
                <p className={`text-sm mt-1.5 ${lightMode ? "text-slate-600" : "text-slate-400"}`}>
                  Business-level cover for all drivers & vehicles — not issued per unit.
                </p>
              </div>
              <span
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                  coidaStatus.color === "red"
                    ? "bg-rose-600 text-white"
                    : coidaStatus.color === "yellow"
                    ? "bg-amber-500 text-white"
                    : "bg-emerald-600 text-white"
                }`}
              >
                {coidaStatus.color === "red"
                  ? "Critical"
                  : coidaStatus.color === "yellow"
                  ? "Attention"
                  : "Healthy"}
              </span>
            </div>
            <div className="mt-5 grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className={`ops-label ${lightMode ? "text-slate-500" : ""}`}>Expiry date</p>
                <p className="text-xl font-semibold mt-1 tabular-nums tracking-tight">
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
                <p className={`ops-label ${lightMode ? "text-slate-500" : ""}`}>Status</p>
                <p className="text-lg font-medium mt-1">
                  {coidaStatus.label}
                  {coidaStatus.days !== null && coidaStatus.days >= 0 && (
                    <span
                      className={`block text-sm font-normal mt-0.5 ${
                        lightMode ? "text-slate-600" : "text-slate-400"
                      }`}
                    >
                      {coidaStatus.days} day{coidaStatus.days === 1 ? "" : "s"} remaining
                    </span>
                  )}
                </p>
              </div>
            </div>
            <p
              className={`mt-5 text-xs leading-relaxed ${
                lightMode ? "text-slate-600" : "text-slate-500"
              }`}
            >
              Renewal typically takes{" "}
              <strong className={lightMode ? "text-slate-800" : "text-slate-200"}>
                5–15 working days
              </strong>
              . Start when status turns yellow (≤50 days) so cover never lapses.
            </p>
          </div>
        </section>

        {/* Risk Ranking */}
        <section id="risk" className="scroll-mt-28">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <h2 className="ops-section-title">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
                <AlertTriangle className="w-4 h-4" />
              </span>
              Risk ranking
            </h2>
            <p className={`text-xs ${theme.cardMuted}`}>
              Service · Roadworthy · Income exposure
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {(showAllRisk ? risks : risks.slice(0, 6)).map((r) => {
              const v = vehicles.find((x) => x.id === r.vehicle_id);
              if (!v) return null;
              return (
                <div key={v.id} id={`risk-card-${v.id}`} className="animate-fade-in">
                  <VehicleCard
                    vehicle={v}
                    riskScore={r.total_risk}
                    onSelect={(v) => {
                      setSelectedContext("risk");
                      setSelected(v);
                    }}
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
                className={`inline-flex items-center justify-center gap-2 w-full sm:w-auto min-h-[44px] px-5 py-3 text-sm border transition ${theme.seeMore}`}
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

        {/* Downtime & Reschedule helper — highest operational priority */}
        {downVehicles.length > 0 && (
          <section
            id="downtime"
            className={`relative overflow-hidden border rounded-2xl p-5 sm:p-6 ${
              lightMode
                ? "bg-rose-50 border-rose-200 text-slate-900"
                : "bg-gradient-to-br from-rose-950/40 via-[#0D1320] to-[#0D1320] border-rose-500/30 text-slate-100 shadow-glow-rose"
            }`}
          >
            <div className="absolute top-0 right-0 w-40 h-40 bg-rose-500/10 blur-3xl rounded-full pointer-events-none" />
            <h2
              className={`ops-section-title mb-4 relative ${
                lightMode ? "text-rose-800" : "text-rose-200"
              }`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400">
                <CalendarClock className="w-4 h-4" />
              </span>
              Vehicles offline — schedule shuffle
            </h2>
            <div className="space-y-3 relative">
              {downVehicles.map((v) => (
                <div
                  key={v.id}
                  className={`flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border ${
                    lightMode
                      ? "bg-white border-rose-100 shadow-sm"
                      : "bg-[#121A2B]/80 border-rose-500/20"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold flex flex-wrap items-center gap-2">
                      <span className="font-mono text-cyan-400 tracking-wide">{v.plate}</span>
                      <span className={`text-xs font-normal ${theme.cardMuted}`}>
                        {v.vehicle_id}
                      </span>
                      <span
                        className={`ops-status ${
                          v.status === "accident"
                            ? lightMode
                              ? "bg-rose-100 text-rose-700 border-rose-200"
                              : "bg-rose-500/15 text-rose-300 border-rose-500/40"
                            : lightMode
                            ? "bg-amber-100 text-amber-800 border-amber-200"
                            : "bg-amber-500/15 text-amber-300 border-amber-500/40"
                        }`}
                      >
                        {v.status}
                      </span>
                    </p>
                    <p className={`text-sm mt-1 ${lightMode ? "text-slate-600" : "text-slate-400"}`}>
                      {v.notes || "No notes"}
                    </p>
                    <p
                      className={`text-xs mt-1.5 font-medium tabular-nums ${
                        lightMode ? "text-rose-600" : "text-rose-300"
                      }`}
                    >
                      Income at risk · R{Number(v.estimated_daily_income).toLocaleString()}/day
                    </p>
                  </div>
                  <div
                    className={`text-sm max-w-md ${
                      lightMode ? "text-slate-700" : "text-slate-300"
                    }`}
                  >
                    <p className="font-medium text-cyan-500/90">Suggested reassignment</p>
                    <p className={`text-xs mt-1 leading-relaxed ${theme.cardMuted}`}>
                      Move jobs to highest-availability active units with similar capacity.
                    </p>
                    <p className={`text-xs mt-2 ${theme.cardMuted}`}>
                      Candidates:{" "}
                      <span className="font-mono text-cyan-400/90">
                        {vehicles
                          .filter((x) => x.status === "active" && x.id !== v.id)
                          .slice(0, 3)
                          .map((x) => x.plate)
                          .join(" · ") || "None available"}
                      </span>
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
                className={`sheet-panel fixed bottom-0 left-0 right-0 z-50 ${theme.popup} border-t rounded-t-2xl p-5 shadow-2xl max-h-[75vh] overflow-y-auto hide-scrollbar pb-8 ${
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
                className={`sheet-panel fixed bottom-0 left-0 right-0 z-50 ${theme.popup} border-t rounded-t-2xl p-5 shadow-2xl max-h-[75vh] overflow-y-auto hide-scrollbar pb-8 ${
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


      {/* Fleet search popup — plates, makes/models, drivers */}
      {showSearchPopup && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/50">
          <div
            className={`flex-1 m-0 sm:m-4 sm:rounded-2xl overflow-hidden flex flex-col ${theme.popup} border ${theme.tableBorder} shadow-2xl`}
          >
            <div className={`flex items-center justify-between gap-3 px-4 py-3 border-b ${theme.tableBorder}`}>
              <div className="flex items-center gap-2">
                <Search className="w-5 h-5 text-cyan-500" />
                <div>
                  <p className="font-semibold">Search fleet</p>
                  <p className={`text-xs ${theme.cardMuted}`}>
                    Plates · make/model · drivers
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSearchPopup(false);
                  setSearchResult(null);
                  setSearchQuery("");
                }}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg ${theme.btn}`}
                aria-label="Close search"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 pt-3 pb-2">
              <input
                type="search"
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchResult(null);
                }}
                placeholder="e.g. CA 123, Hilux, Thabo, FLT-001…"
                className={`w-full min-h-[48px] rounded-xl border px-4 text-sm ${theme.tableBorder} bg-transparent`}
              />
              <p className={`text-[10px] mt-1.5 ${theme.cardMuted}`}>
                Province codes (CA, GP, WC…) match whether they are at the front or back of the plate.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto hide-scrollbar px-4 pb-24 space-y-4">
              {!searchResult && searchQuery.trim() && (
                <>
                  {searchHits.vehicles.length > 0 && (
                    <div>
                      <p className={`text-xs font-semibold uppercase mb-2 ${theme.cardMuted}`}>
                        Vehicles ({searchHits.vehicles.length})
                      </p>
                      <ul className="space-y-1.5">
                        {searchHits.vehicles.map((v) => (
                          <li key={v.id}>
                            <button
                              type="button"
                              onClick={() => selectSearchVehicle(v)}
                              className={`w-full text-left rounded-xl border px-3 py-2.5 min-h-[48px] transition hover:ring-2 hover:ring-cyan-500/40 ${theme.tableBorder}`}
                            >
                              <span className="font-semibold text-cyan-500">{v.plate}</span>
                              <span className={`text-xs ml-2 ${theme.cardMuted}`}>
                                {v.vehicle_id} · {v.make} {v.model}
                              </span>
                              <span
                                className={`block text-[11px] mt-0.5 capitalize ${
                                  v.status === "active"
                                    ? "text-emerald-500"
                                    : v.status === "maintenance"
                                    ? "text-amber-500"
                                    : v.status === "accident"
                                    ? "text-red-500"
                                    : theme.cardMuted
                                }`}
                              >
                                {v.status}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {searchHits.drivers.length > 0 && (
                    <div>
                      <p className={`text-xs font-semibold uppercase mb-2 ${theme.cardMuted}`}>
                        Drivers ({searchHits.drivers.length})
                      </p>
                      <ul className="space-y-1.5">
                        {searchHits.drivers.map((d) => (
                          <li key={d.id}>
                            <button
                              type="button"
                              onClick={() => selectSearchDriver(d)}
                              className={`w-full text-left rounded-xl border px-3 py-2.5 min-h-[48px] transition hover:ring-2 hover:ring-cyan-500/40 ${theme.tableBorder}`}
                            >
                              <span className="font-semibold">{d.name}</span>
                              <span className={`text-xs ml-2 ${theme.cardMuted}`}>
                                {d.license_number || "—"} · {d.status}
                              </span>
                              {d.phone && (
                                <span className={`block text-[11px] mt-0.5 ${theme.cardMuted}`}>
                                  {d.phone}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {searchHits.vehicles.length === 0 && searchHits.drivers.length === 0 && (
                    <p className={`text-sm ${theme.cardMuted}`}>No matches for “{searchQuery.trim()}”.</p>
                  )}
                </>
              )}

              {!searchResult && !searchQuery.trim() && (
                <p className={`text-sm ${theme.cardMuted}`}>
                  Type a number plate, make, model, fleet ID, or driver name to search.
                </p>
              )}

              {/* Vehicle detail */}
              {searchResult?.type === "vehicle" && (() => {
                const v = searchResult.vehicle;
                const kmLeft = kmToNextService(v);
                const rwDays = daysUntil(v.roadworthy_expiry);
                const assigned = drivers.find((d) => d.id === v.assigned_driver_id) || null;
                const vSchedules = schedules
                  .filter((s) => s.vehicle_id === v.id)
                  .sort(
                    (a, b) =>
                      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
                  )
                  .slice(0, 8);
                return (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setSearchResult(null)}
                      className={`text-xs ${theme.cardMuted} underline`}
                    >
                      ← Back to results
                    </button>
                    <div className={`rounded-xl border p-4 space-y-1 ${theme.tableBorder}`}>
                      <p className="text-lg font-bold text-cyan-500">{v.plate}</p>
                      <p className="text-sm">
                        {v.make} {v.model} {v.year ? `(${v.year})` : ""} · {v.vehicle_id}
                      </p>
                      <p className={`text-xs capitalize ${theme.cardMuted}`}>Status: {v.status}</p>
                    </div>

                    {/* Service */}
                    <div className={`rounded-xl border p-3 space-y-1 text-sm ${theme.tableBorder}`}>
                      <p className="font-semibold flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-amber-500" /> Service
                      </p>
                      <p>
                        <span className={theme.cardMuted}>Last service: </span>
                        {formatDate(v.last_service_date)}
                        {v.last_service_odometer != null &&
                          ` @ ${Number(v.last_service_odometer).toLocaleString()} km`}
                      </p>
                      <p>
                        <span className={theme.cardMuted}>Odometer: </span>
                        {Number(v.current_odometer || 0).toLocaleString()} km
                      </p>
                      <p>
                        <span className={theme.cardMuted}>Km to next ({v.service_interval_km || 5000} km interval): </span>
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
                    </div>

                    {/* Certificates */}
                    <div className={`rounded-xl border p-3 space-y-1 text-sm ${theme.tableBorder}`}>
                      <p className="font-semibold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" /> Certificates
                      </p>
                      <p>
                        <span className={theme.cardMuted}>Roadworthy: </span>
                        {formatDate(v.roadworthy_expiry)}
                        {rwDays != null && (
                          <span
                            className={
                              rwDays < 0
                                ? " text-red-500"
                                : rwDays <= 20
                                ? " text-amber-500"
                                : " text-emerald-500"
                            }
                          >
                            {" "}
                            ({rwDays < 0 ? `expired ${Math.abs(rwDays)}d ago` : `${rwDays}d left`})
                          </span>
                        )}
                      </p>
                      <p className={`text-xs ${theme.cardMuted}`}>
                        COIDA is company-level (see Home) — not issued per vehicle.
                      </p>
                    </div>

                    {/* Driver */}
                    <div className={`rounded-xl border p-3 space-y-1 text-sm ${theme.tableBorder}`}>
                      <p className="font-semibold flex items-center gap-2">
                        <Users className="w-4 h-4 text-cyan-500" /> Assigned driver
                      </p>
                      {assigned ? (
                        <>
                          <p className="font-medium">{assigned.name}</p>
                          <p className={`text-xs ${theme.cardMuted}`}>
                            {assigned.license_number || "—"} · {assigned.status}
                          </p>
                          {assigned.phone && (
                            <a href={`tel:${assigned.phone}`} className="text-cyan-500 text-sm flex items-center gap-1">
                              <Phone className="w-3.5 h-3.5" /> {assigned.phone}
                            </a>
                          )}
                        </>
                      ) : (
                        <p className={theme.cardMuted}>No driver assigned</p>
                      )}
                    </div>

                    {/* Schedules */}
                    <div className={`rounded-xl border p-3 space-y-2 text-sm ${theme.tableBorder}`}>
                      <p className="font-semibold flex items-center gap-2">
                        <CalendarClock className="w-4 h-4 text-violet-500" /> Upcoming schedules
                      </p>
                      {vSchedules.length === 0 ? (
                        <p className={theme.cardMuted}>No schedules on file</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {vSchedules.map((s) => (
                            <li key={s.id} className={`rounded-lg border px-2 py-1.5 text-xs ${theme.tableBorder}`}>
                              <span className="font-medium capitalize">{s.status}</span>
                              {" · "}
                              {s.job_type || "job"}
                              {s.location ? ` · ${s.location}` : ""}
                              <span className={`block ${theme.cardMuted}`}>
                                {new Date(s.start_time).toLocaleString()}
                                {s.end_time
                                  ? ` → ${new Date(s.end_time).toLocaleString()}`
                                  : ""}
                              </span>
                              {s.job_description && (
                                <span className="block mt-0.5">{s.job_description}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* AI analytics */}
                    <div className={`rounded-xl border p-3 space-y-2 text-sm ${theme.tableBorder}`}>
                      <p className="font-semibold flex items-center gap-2">
                        <Brain className="w-4 h-4 text-cyan-500" /> Vehicle AI analytics
                      </p>
                      {loadingSearchAnalytics && (
                        <div className="flex items-center gap-2 text-xs text-cyan-500">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Loading fuel &amp; service insights…
                        </div>
                      )}
                      {!loadingSearchAnalytics && searchServiceAnalytics && (
                        <div className="space-y-1 text-xs">
                          <p className="font-medium text-amber-500">Service</p>
                          <p className={theme.cardMuted}>{searchServiceAnalytics.summary}</p>
                          {Array.isArray(searchServiceAnalytics.recommendations) &&
                            searchServiceAnalytics.recommendations.slice(0, 3).map((r: string, i: number) => (
                              <p key={i}>• {r}</p>
                            ))}
                        </div>
                      )}
                      {!loadingSearchAnalytics && searchFuelAnalytics && (
                        <div className="space-y-1 text-xs mt-2">
                          <p className="font-medium text-cyan-500">Fuel</p>
                          <p className={theme.cardMuted}>{searchFuelAnalytics.summary}</p>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                            <span className={theme.cardMuted}>Refuels</span>
                            <span>{searchFuelAnalytics.refuel_count}</span>
                            <span className={theme.cardMuted}>Total litres</span>
                            <span>{searchFuelAnalytics.total_liters_refueled} L</span>
                            <span className={theme.cardMuted}>vs expected</span>
                            <span className="capitalize">{searchFuelAnalytics.consumption_vs_expected}</span>
                            <span className={theme.cardMuted}>Reserve impact</span>
                            <span className="capitalize">{searchFuelAnalytics.impact_on_reserve}</span>
                          </div>
                          {Array.isArray(searchFuelAnalytics.recommendations) &&
                            searchFuelAnalytics.recommendations.slice(0, 3).map((r: string, i: number) => (
                              <p key={i}>• {r}</p>
                            ))}
                        </div>
                      )}
                      {!loadingSearchAnalytics && !searchFuelAnalytics && !searchServiceAnalytics && (
                        <p className={`text-xs ${theme.cardMuted}`}>
                          No AI analytics available (demo mode or API offline).
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Driver detail */}
              {searchResult?.type === "driver" && (() => {
                const d = searchResult.driver;
                const assignedVehicles = vehicles.filter((v) => v.assigned_driver_id === d.id);
                const dSchedules = schedules
                  .filter((s) => s.driver_id === d.id)
                  .sort(
                    (a, b) =>
                      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
                  )
                  .slice(0, 8);
                return (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setSearchResult(null)}
                      className={`text-xs ${theme.cardMuted} underline`}
                    >
                      ← Back to results
                    </button>
                    <div className={`rounded-xl border p-4 space-y-1 ${theme.tableBorder}`}>
                      <p className="text-lg font-bold">{d.name}</p>
                      <p className={`text-sm ${theme.cardMuted}`}>
                        License: {d.license_number || "—"} · Status: {d.status}
                      </p>
                      {d.phone && (
                        <a href={`tel:${d.phone}`} className="text-cyan-500 text-sm flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5" /> {d.phone}
                        </a>
                      )}
                    </div>

                    <div className={`rounded-xl border p-3 space-y-2 text-sm ${theme.tableBorder}`}>
                      <p className="font-semibold flex items-center gap-2">
                        <Fuel className="w-4 h-4 text-cyan-500" /> Assigned vehicles
                      </p>
                      {assignedVehicles.length === 0 ? (
                        <p className={theme.cardMuted}>No vehicles assigned</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {assignedVehicles.map((v) => (
                            <li key={v.id}>
                              <button
                                type="button"
                                onClick={() => selectSearchVehicle(v)}
                                className={`w-full text-left rounded-lg border px-2 py-2 text-xs hover:ring-2 hover:ring-cyan-500/40 ${theme.tableBorder}`}
                              >
                                <span className="font-semibold text-cyan-500">{v.plate}</span>
                                {" · "}
                                {v.make} {v.model}
                                <span className={`block capitalize ${theme.cardMuted}`}>{v.status}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className={`rounded-xl border p-3 space-y-2 text-sm ${theme.tableBorder}`}>
                      <p className="font-semibold flex items-center gap-2">
                        <CalendarClock className="w-4 h-4 text-violet-500" /> Driver schedules
                      </p>
                      {dSchedules.length === 0 ? (
                        <p className={theme.cardMuted}>No schedules on file</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {dSchedules.map((s) => {
                            const veh = vehicles.find((x) => x.id === s.vehicle_id);
                            return (
                              <li key={s.id} className={`rounded-lg border px-2 py-1.5 text-xs ${theme.tableBorder}`}>
                                <span className="font-medium capitalize">{s.status}</span>
                                {veh ? ` · ${veh.plate}` : ""}
                                {s.job_type ? ` · ${s.job_type}` : ""}
                                <span className={`block ${theme.cardMuted}`}>
                                  {new Date(s.start_time).toLocaleString()}
                                </span>
                                {s.job_description && (
                                  <span className="block mt-0.5">{s.job_description}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Roadworthy ≤20 days popup */}
      {showRoadworthyPopup && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4">
          <div
            className={`w-full sm:max-w-lg max-h-[75vh] overflow-y-auto hide-scrollbar rounded-t-2xl sm:rounded-2xl border p-5 shadow-2xl ${theme.popup} ${theme.tableBorder}`}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-semibold">Roadworthy expiring ≤ 20 days</p>
                <p className={`text-xs ${theme.cardMuted}`}>{certAlerts.length} vehicle(s)</p>
              </div>
              <button
                type="button"
                onClick={() => setShowRoadworthyPopup(false)}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg ${theme.btn}`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {certAlerts.length === 0 ? (
              <p className={`text-sm ${theme.cardMuted}`}>No certificates in the 20-day window.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {certAlerts.map((v) => {
                  const days = daysUntil(v.roadworthy_expiry);
                  const drv = drivers.find((d) => d.id === v.assigned_driver_id);
                  return (
                    <li
                      key={v.id}
                      className={`p-3 rounded-xl border ${theme.tableBorder}`}
                    >
                      <p className="font-medium">
                        {v.make} {v.model} · <span className="font-mono text-cyan-500">{v.plate}</span>
                      </p>
                      <p className={`text-xs ${theme.cardMuted}`}>
                        Driver: {drv?.name || "Unassigned"}
                      </p>
                      <p
                        className={`text-xs font-medium ${
                          days != null && days < 0
                            ? "text-red-500"
                            : days != null && days <= 7
                            ? "text-red-500"
                            : "text-amber-500"
                        }`}
                      >
                        {days != null
                          ? days < 0
                            ? `Expired ${Math.abs(days)}d ago`
                            : `${days} day${days === 1 ? "" : "s"} remaining`
                          : "Date unknown"}{" "}
                        · {formatDate(v.roadworthy_expiry)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setShowRoadworthyPopup(false)}
              className="mt-4 w-full min-h-[48px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Fuel reserve update modal */}
      {showFuelReserveModal && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4">
          <div
            className={`w-full sm:max-w-md max-h-[75vh] overflow-y-auto hide-scrollbar rounded-t-2xl sm:rounded-2xl border p-5 shadow-2xl ${theme.popup} ${theme.tableBorder}`}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-semibold">Bulk fuel reserve</p>
                <p className={`text-xs ${theme.cardMuted}`}>
                  Enter tank litres or a Rand budget — final reserve is always stored &amp; shown in litres
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFuelReserveModal(false)}
                className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg ${theme.btn}`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setFuelReserveMode("tank")}
                className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium border ${
                  fuelReserveMode === "tank"
                    ? "bg-cyan-600 text-white border-cyan-600"
                    : theme.btn
                }`}
              >
                Bulk tank (L)
              </button>
              <button
                type="button"
                onClick={() => setFuelReserveMode("budget")}
                className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium border ${
                  fuelReserveMode === "budget"
                    ? "bg-cyan-600 text-white border-cyan-600"
                    : theme.btn
                }`}
              >
                Budget (R)
              </button>
            </div>
            {fuelReserveMode === "tank" ? (
              <label className="block text-sm space-y-1">
                <span className={theme.cardMuted}>Current tank level (litres)</span>
                <input
                  type="number"
                  min={0}
                  value={fuelReserveLitersInput}
                  onChange={(e) => setFuelReserveLitersInput(e.target.value)}
                  className={`w-full min-h-[48px] rounded-lg border px-3 ${theme.tableBorder} bg-transparent`}
                />
              </label>
            ) : (
              <label className="block text-sm space-y-1">
                <span className={theme.cardMuted}>Fuel budget (Rand)</span>
                <input
                  type="number"
                  min={0}
                  value={fuelBudgetInput}
                  onChange={(e) => setFuelBudgetInput(e.target.value)}
                  className={`w-full min-h-[48px] rounded-lg border px-3 ${theme.tableBorder} bg-transparent`}
                />
                <span className={`text-[10px] ${theme.cardMuted}`}>
                  AI researches current diesel price and converts this Rand budget into litres. The
                  dashboard always displays and tracks reserve in litres. Fuel-slip costs reduce the
                  remaining budget (and thus the litre equivalent).
                </span>
              </label>
            )}
            {fuelReserveMsg && (
              <p className="mt-3 text-xs text-cyan-500 font-medium">{fuelReserveMsg}</p>
            )}
            <button
              type="button"
              disabled={savingFuelReserve}
              onClick={saveFuelReserve}
              className="mt-4 w-full min-h-[48px] rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium"
            >
              {savingFuelReserve ? "Saving…" : "Save reserve"}
            </button>
          </div>
        </div>
      )}

      {/* Bottom navigation – mobile-first command dock */}
      <nav className={`fixed bottom-0 left-0 right-0 z-30 ${theme.nav} safe-area-pb`}>
        <div className="max-w-7xl mx-auto grid grid-cols-5 gap-0.5 px-1.5 py-1.5">
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
                className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[56px] rounded-xl text-[10px] sm:text-[11px] font-semibold tracking-wide transition-all duration-150 ${
                  active ? theme.navActive : theme.navIdle
                } ${active ? "bg-cyan-500/10" : "hover:bg-slate-800/40"}`}
              >
                {active && (
                  <span className="absolute top-1.5 h-0.5 w-6 rounded-full bg-cyan-400 shadow-glow-cyan" />
                )}
                <Icon className={`w-5 h-5 ${active ? "scale-105" : ""} transition-transform`} />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}