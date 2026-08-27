-- Fleet Manager Schema for Supabase PostgreSQL

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plate TEXT UNIQUE NOT NULL,
  vehicle_id TEXT UNIQUE NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER,
  current_odometer NUMERIC(12,1) DEFAULT 0,
  last_service_date DATE,
  last_service_odometer NUMERIC(12,1),
  service_interval_km INTEGER DEFAULT 5000,
  coida_expiry DATE,
  roadworthy_expiry DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'accident', 'inactive')),
  estimated_daily_income NUMERIC(10,2) DEFAULT 0,
  fuel_efficiency_l_per_100km NUMERIC(6,2),
  current_fuel_level_pct NUMERIC(5,1), -- last known tank % from fuel slip scan
  last_refuel_date TIMESTAMPTZ,
  assigned_driver_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  license_number TEXT,
  phone TEXT,
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'off')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vehicles
  ADD CONSTRAINT fk_assigned_driver
  FOREIGN KEY (assigned_driver_id) REFERENCES drivers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS fuel_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  amount_liters NUMERIC(10,2) NOT NULL,
  cost NUMERIC(12,2),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('bulk_purchase', 'vehicle_refuel', 'adjustment')),
  odometer_at_refuel NUMERIC(12,1),
  fuel_level_after_pct NUMERIC(5,1),
  station_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrade helpers for existing DBs:
-- ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS current_fuel_level_pct NUMERIC(5,1);
-- ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_refuel_date TIMESTAMPTZ;
-- ALTER TABLE fuel_transactions ADD COLUMN IF NOT EXISTS fuel_level_after_pct NUMERIC(5,1);
-- ALTER TABLE fuel_transactions ADD COLUMN IF NOT EXISTS station_name TEXT;

CREATE TABLE IF NOT EXISTS document_scans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  document_type TEXT,
  plate TEXT,
  vehicle_id_extracted TEXT,
  holder_name TEXT,
  issue_date DATE,
  expiry_date DATE,
  raw_extraction JSONB,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  job_description TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'delivered', 'failed')),
  location TEXT,
  job_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrade existing DBs:
-- ALTER TABLE schedules ADD COLUMN IF NOT EXISTS location TEXT;
-- ALTER TABLE schedules ADD COLUMN IF NOT EXISTS job_type TEXT;
-- ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_status_check;
-- ALTER TABLE schedules ADD CONSTRAINT schedules_status_check CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'delivered', 'failed'));


CREATE TABLE IF NOT EXISTS fuel_reserve (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  current_liters NUMERIC(12,2) NOT NULL DEFAULT 0,
  capacity_liters NUMERIC(12,2) DEFAULT 10000,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);
CREATE INDEX IF NOT EXISTS idx_vehicles_coida ON vehicles(coida_expiry);
CREATE INDEX IF NOT EXISTS idx_vehicles_roadworthy ON vehicles(roadworthy_expiry);
CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_transactions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_schedules_vehicle ON schedules(vehicle_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_vehicles_updated_at ON vehicles;
CREATE TRIGGER update_vehicles_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO fuel_reserve (current_liters, capacity_liters, notes)
SELECT 8500, 10000, 'Initial bulk tank level'
WHERE NOT EXISTS (SELECT 1 FROM fuel_reserve LIMIT 1);


-- Company-level compliance (COIDA is business-wide, not per vehicle)
CREATE TABLE IF NOT EXISTS company_compliance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coida_expiry DATE,
  company_name TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO company_compliance (coida_expiry, company_name, notes)
SELECT '2026-09-15'::date, 'Fleet Solutions (Pty) Ltd', 'Company-wide COIDA registration'
WHERE NOT EXISTS (SELECT 1 FROM company_compliance LIMIT 1);


-- Fraud flags when fuel slip litres/spend do not match researched prices
CREATE TABLE IF NOT EXISTS fraud_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  document_scan_id UUID REFERENCES document_scans(id) ON DELETE SET NULL,
  fuel_transaction_id UUID REFERENCES fuel_transactions(id) ON DELETE SET NULL,
  plate TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  match_status TEXT, -- under_liters | over_liters
  slip_liters NUMERIC(10,2),
  expected_liters NUMERIC(10,2),
  cost_zar NUMERIC(12,2),
  researched_price_per_litre NUMERIC(8,2),
  liters_delta NUMERIC(10,2),
  liters_delta_pct NUMERIC(8,2),
  reason TEXT,
  voice_script TEXT,
  voice_note_status TEXT DEFAULT 'pending'
    CHECK (voice_note_status IN ('pending', 'sent', 'delivered', 'acknowledged', 'failed')),
  voice_sent_at TIMESTAMPTZ,
  voice_acknowledged_at TIMESTAMPTZ,
  driver_response TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'meeting_scheduled', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_vehicle ON fraud_alerts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fraud_status ON fraud_alerts(status);
CREATE INDEX IF NOT EXISTS idx_fraud_voice ON fraud_alerts(voice_note_status);

-- Fraud flags from fuel slip price/litre mismatches
CREATE TABLE IF NOT EXISTS fraud_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  fuel_transaction_id UUID REFERENCES fuel_transactions(id) ON DELETE SET NULL,
  document_scan_id UUID REFERENCES document_scans(id) ON DELETE SET NULL,
  plate TEXT,
  reason TEXT NOT NULL,
  match_status TEXT,
  slip_liters NUMERIC(10,2),
  expected_liters NUMERIC(10,2),
  cost_zar NUMERIC(12,2),
  researched_price_per_litre NUMERIC(8,2),
  liters_delta NUMERIC(10,2),
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'voice_sent', 'acknowledged', 'resolved', 'dismissed')),
  voice_note_script TEXT,
  voice_note_sent_at TIMESTAMPTZ,
  driver_acknowledged_at TIMESTAMPTZ,
  driver_response TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_vehicle ON fraud_flags(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fraud_status ON fraud_flags(status);
CREATE INDEX IF NOT EXISTS idx_fraud_driver ON fraud_flags(driver_id);
