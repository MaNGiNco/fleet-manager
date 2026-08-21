export type VehicleStatus = "active" | "maintenance" | "accident" | "inactive";

export interface Vehicle {
  id: string;
  plate: string;
  vehicle_id: string; // internal fleet ID
  make: string;
  model: string;
  year: number;
  current_odometer: number;
  last_service_date: string | null;
  last_service_odometer: number | null;
  service_interval_km: number; // default 5000
  coida_expiry: string | null;
  roadworthy_expiry: string | null;
  status: VehicleStatus;
  estimated_daily_income: number; // for risk/income exposure
  fuel_efficiency_l_per_100km: number | null;
  assigned_driver_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Driver {
  id: string;
  name: string;
  license_number: string;
  phone: string | null;
  status: "available" | "assigned" | "off";
  created_at: string;
}

export interface FuelTransaction {
  id: string;
  vehicle_id: string | null; // null for bulk purchase
  amount_liters: number;
  cost: number;
  transaction_type: "bulk_purchase" | "vehicle_refuel" | "adjustment";
  odometer_at_refuel: number | null;
  notes: string | null;
  created_at: string;
}

export interface DocumentScan {
  id: string;
  vehicle_id: string | null;
  document_type: string;
  plate: string | null;
  vehicle_id_extracted: string | null;
  holder_name: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  raw_extraction: any;
  image_url: string | null;
  created_at: string;
}

export interface Schedule {
  id: string;
  vehicle_id: string;
  driver_id: string | null;
  start_time: string;
  end_time: string;
  job_description: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  created_at: string;
}

export interface RiskScore {
  vehicle_id: string;
  plate: string;
  service_risk: number; // 0-100
  certificate_risk: number;
  income_exposure: number;
  total_risk: number;
  reasons: string[];
}

export interface FuelImpact {
  vehicle_id: string;
  plate: string;
  total_liters_used: number;
  percentage_of_reserve: number;
  efficiency_score: number; // relative
  impact_rating: "low" | "medium" | "high" | "critical";
}
