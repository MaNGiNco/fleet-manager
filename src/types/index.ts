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
  current_fuel_level_pct: number | null; // last known tank % from fuel slip
  last_refuel_date: string | null;
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
  fuel_level_after_pct: number | null; // 0-100 tank % after fill if known
  station_name: string | null;
  notes: string | null;
  created_at: string;
}

/** AI-derived fuel analytics for a single vehicle (shown in plate detail sheet) */
export interface FuelAnalytics {
  vehicle_id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  current_fuel_level_pct: number | null;
  last_refuel_liters: number | null;
  last_refuel_date: string | null;
  refuel_count: number;
  total_liters_refueled: number;
  avg_liters_per_refuel: number | null;
  days_between_refuels_avg: number | null;
  researched_avg_l_per_100km: number | null; // from OpenRouter research on make/model
  fleet_recorded_efficiency: number | null;
  consumption_vs_expected: "better" | "inline" | "worse" | "unknown";
  consumption_delta_pct: number | null; // % worse/better than researched
  impact_on_reserve: "low" | "medium" | "high" | "critical";
  summary: string;
  recommendations: string[];
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
  end_time: string | null;
  job_description: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "delivered" | "failed";
  location: string | null;
  job_type: string | null;
  created_at: string;
}

export interface ScheduleClash {
  type: "vehicle" | "driver";
  message: string;
  existing_schedule_id: string;
  existing_start: string;
  existing_end: string | null;
  existing_job: string | null;
  plate?: string;
  driver_name?: string;
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


export type VoiceNoteStatus = "pending" | "sent" | "delivered" | "acknowledged" | "failed";
export type FraudAlertStatus = "open" | "meeting_scheduled" | "resolved" | "dismissed";

export interface FraudAlert {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  document_scan_id: string | null;
  fuel_transaction_id: string | null;
  plate: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  match_status: "under_liters" | "over_liters" | string;
  slip_liters: number | null;
  expected_liters: number | null;
  cost_zar: number | null;
  researched_price_per_litre: number | null;
  liters_delta: number | null;
  liters_delta_pct: number | null;
  reason: string | null;
  voice_script: string | null;
  voice_note_status: VoiceNoteStatus;
  voice_sent_at: string | null;
  voice_acknowledged_at: string | null;
  driver_response: string | null;
  status: FraudAlertStatus;
  created_at: string;
  updated_at: string;
}


export type FraudFlagStatus = "open" | "voice_sent" | "acknowledged" | "resolved" | "dismissed";

export interface FraudFlag {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  fuel_transaction_id: string | null;
  document_scan_id: string | null;
  plate: string | null;
  reason: string;
  match_status: string | null;
  slip_liters: number | null;
  expected_liters: number | null;
  cost_zar: number | null;
  researched_price_per_litre: number | null;
  liters_delta: number | null;
  severity: "low" | "medium" | "high" | "critical";
  status: FraudFlagStatus;
  voice_note_script: string | null;
  voice_note_sent_at: string | null;
  driver_acknowledged_at: string | null;
  driver_response: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
