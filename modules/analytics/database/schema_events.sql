-- Raw Analytics Events (Actual Table Schema)
CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id TEXT NOT NULL,
    user_id UUID,
    session_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    placement_id UUID,
    placement_type VARCHAR(50),
    position INTEGER,
    referrer_entity_type VARCHAR(50),
    referrer_entity_id TEXT,
    referrer_url TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Essential Indexes for Performance
CREATE INDEX idx_analytics_events_tenant_time ON analytics_events(tenant_id, created_at DESC);
CREATE INDEX idx_analytics_events_entity ON analytics_events(tenant_id, entity_type, entity_id);
CREATE INDEX idx_analytics_events_composite ON analytics_events(tenant_id, event_type, created_at);
