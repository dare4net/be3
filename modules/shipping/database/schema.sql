-- Shipping Module Schema
-- PRINCIPLE: Multi-tenant by default

-- Shipping Zones (e.g., "Domestic", "International")
CREATE TABLE IF NOT EXISTS shipping_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  regions TEXT[], -- Array of country codes e.g. ['US', 'CA']
  created_at TIMESTAMP DEFAULT NOW()
);

-- Shipping Rates
CREATE TABLE IF NOT EXISTS shipping_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  zone_id UUID REFERENCES shipping_zones(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL, -- "Standard", "Express"
  type VARCHAR(50) NOT NULL, -- "flat_rate", "percentage", "free_shipping"
  amount DECIMAL(10, 2) DEFAULT 0,
  min_order_value DECIMAL(10, 2), -- Condition for rate
  created_at TIMESTAMP DEFAULT NOW()
);

-- Shipments (Linked to Orders)
CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL, -- Weak reference to orders module (no FK constraint across modules)
  tracking_number VARCHAR(100),
  carrier VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending', -- pending, shipped, delivered
  shipped_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_shipments_order ON shipments(order_id);
