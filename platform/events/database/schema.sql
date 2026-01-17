-- Event Logs Table
-- Stores all system events for audit trail and debugging

CREATE TABLE IF NOT EXISTS event_logs (
  id SERIAL PRIMARY KEY,
  event_name VARCHAR(255) NOT NULL,
  event_data JSONB NOT NULL,
  tenant_id UUID NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_event_logs_event_name ON event_logs(event_name);
CREATE INDEX idx_event_logs_tenant_id ON event_logs(tenant_id);
CREATE INDEX idx_event_logs_created_at ON event_logs(created_at DESC);
CREATE INDEX idx_event_logs_tenant_event ON event_logs(tenant_id, event_name);

-- Partition hint: Consider partitioning by created_at for large-scale deployments
COMMENT ON TABLE event_logs IS 'Audit trail of all system events';
