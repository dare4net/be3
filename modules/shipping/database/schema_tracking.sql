-- Add Tracking Fields to Shipments
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS courier_code VARCHAR(100);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_url VARCHAR(500);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS estimated_delivery TIMESTAMP;
