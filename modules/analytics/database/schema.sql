-- Analytics Module Schema
-- PRINCIPLE: Multi-tenant by default

-- Daily Stats Aggregation
CREATE TABLE IF NOT EXISTS daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_sales DECIMAL(10, 2) DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  new_customers INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_date_per_tenant UNIQUE (tenant_id, date)
);

CREATE INDEX idx_daily_stats_tenant_date ON daily_stats(tenant_id, date);
