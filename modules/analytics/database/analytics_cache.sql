-- Analytics Cache Table
-- Stores aggregated results for various reports to avoid heavy SQL re-computation
CREATE TABLE IF NOT EXISTS analytics_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    cache_key TEXT NOT NULL,
    data JSONB NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT unique_cache_key_per_tenant UNIQUE (tenant_id, cache_key)
);

CREATE INDEX idx_analytics_cache_tenant_key ON analytics_cache(tenant_id, cache_key);
CREATE INDEX idx_analytics_cache_expiry ON analytics_cache(expires_at);
