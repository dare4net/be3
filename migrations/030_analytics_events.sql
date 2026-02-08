-- Migration 030: Analytics Events Module
-- Comprehensive event tracking for impressions, clicks, and page views

CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Event Metadata
    event_type VARCHAR(50) NOT NULL, -- 'impression', 'click', 'page_view'
    entity_type VARCHAR(50) NOT NULL, -- 'product', 'category', 'collection', 'branded_page', 'vendor'
    entity_id VARCHAR(255) NOT NULL, -- Can be numeric ID or composite (e.g., 'AC:123:high_end:456')
    
    -- User Context
    user_id INTEGER, -- Null for anonymous users, no FK constraint as users table may not exist
    session_id VARCHAR(255), -- Browser session identifier
    ip_address INET,
    user_agent TEXT,
    
    -- Placement Context
    placement_id VARCHAR(255), -- Widget ID, 'search_autocomplete', 'search_results_grid', etc.
    placement_type VARCHAR(50), -- 'widget', 'search', 'banner', 'navigation'
    position INTEGER, -- Position in list/grid (1-indexed)
    
    -- Referral Tracking
    referrer_entity_type VARCHAR(50), -- Entity type of the referring page/widget
    referrer_entity_id VARCHAR(255), -- Entity ID of the referring page/widget
    referrer_url TEXT, -- Full referrer URL
    
    -- Additional Context (JSONB for flexibility)
    metadata JSONB DEFAULT '{}', -- Stores additional context like: {clause_name, attribute_code, category_id, sort_order, etc.}
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Composite index for tenant-scoped queries
CREATE INDEX idx_analytics_tenant_event ON analytics_events(tenant_id, event_type, created_at DESC);

-- Entity-specific queries (for dashboard drilldowns)
CREATE INDEX idx_analytics_entity ON analytics_events(tenant_id, entity_type, entity_id, event_type, created_at DESC);

-- Placement-specific queries (widget performance)
CREATE INDEX idx_analytics_placement ON analytics_events(tenant_id, placement_id, event_type, created_at DESC);

-- Session-based deduplication
CREATE INDEX idx_analytics_session ON analytics_events(session_id, entity_type, entity_id, placement_id, event_type);

-- Referral analysis
CREATE INDEX idx_analytics_referrer ON analytics_events(tenant_id, referrer_entity_type, referrer_entity_id, created_at DESC);

-- User behavior tracking (for logged-in users)
CREATE INDEX idx_analytics_user ON analytics_events(user_id, event_type, created_at DESC) WHERE user_id IS NOT NULL;

-- JSONB metadata indexing (for advanced filtering)
CREATE INDEX idx_analytics_metadata ON analytics_events USING gin(metadata);

COMMENT ON TABLE analytics_events IS 'Unified analytics event tracking for impressions, clicks, and page views across all entity types';
COMMENT ON COLUMN analytics_events.entity_id IS 'Supports both numeric IDs and composite keys (e.g., AC:attribute_id:clause_name:category_id for branded pages)';
COMMENT ON COLUMN analytics_events.placement_id IS 'Identifies where the event occurred (widget ID, search autocomplete, etc.)';
COMMENT ON COLUMN analytics_events.metadata IS 'Flexible storage for context-specific data like sort order, filter state, attribute details, etc.';
