-- Raw Analytics Events
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- 'PAGE_VIEWED', 'ADD_TO_CART', 'CHECKOUT_INIT', 'ORDER_PAID'
  user_id UUID,
  session_id VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast time-series lookup
CREATE INDEX idx_analytics_events_time ON analytics_events(tenant_id, created_at DESC);
CREATE INDEX idx_analytics_events_type ON analytics_events(tenant_id, event_type);
