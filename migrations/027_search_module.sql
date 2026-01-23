-- Advanced Search Module Migration
-- Creates search indexes, synonyms, analytics, and filters tables

-- ==========================================
-- SEARCH INDEXES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS search_indexes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL, -- 'product', 'category', 'page'
    content_id UUID NOT NULL,
    title TEXT NOT NULL,
    content TEXT, -- Full text content
    keywords TEXT[], -- Array of keywords
    metadata JSONB, -- Flexible metadata (price, category_id, etc.)
    search_vector tsvector, -- PostgreSQL full-text search vector
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_search_indexes_tenant ON search_indexes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_indexes_type ON search_indexes(tenant_id, content_type);
CREATE INDEX IF NOT EXISTS idx_search_indexes_vector ON search_indexes USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_search_indexes_keywords ON search_indexes USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_search_indexes_metadata ON search_indexes USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_search_indexes_active ON search_indexes(tenant_id, is_active) WHERE is_active = true;

-- ==========================================
-- SEARCH SYNONYMS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS search_synonyms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    term VARCHAR(255) NOT NULL,
    synonyms TEXT[] NOT NULL, -- Array of synonyms
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, term)
);

CREATE INDEX IF NOT EXISTS idx_search_synonyms_tenant ON search_synonyms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_synonyms_term ON search_synonyms(tenant_id, term);
CREATE INDEX IF NOT EXISTS idx_search_synonyms_active ON search_synonyms(tenant_id, is_active) WHERE is_active = true;

-- ==========================================
-- SEARCH ANALYTICS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS search_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    filters JSONB, -- Applied filters
    result_count INTEGER,
    has_results BOOLEAN,
    clicked_result_id UUID, -- If user clicked a result
    content_type VARCHAR(50), -- Type of clicked result
    session_id VARCHAR(255),
    user_id UUID,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_analytics_tenant ON search_analytics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_analytics_query ON search_analytics(tenant_id, query);
CREATE INDEX IF NOT EXISTS idx_search_analytics_created ON search_analytics(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_search_analytics_results ON search_analytics(tenant_id, has_results, created_at);

-- ==========================================
-- SEARCH FILTERS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS search_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    filter_key VARCHAR(100) NOT NULL, -- 'price', 'category', 'attribute.color'
    filter_type VARCHAR(50) NOT NULL, -- 'range', 'select', 'multiselect', 'boolean'
    label VARCHAR(255) NOT NULL,
    config JSONB, -- Filter-specific config (min/max for range, options for select)
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, filter_key)
);

CREATE INDEX IF NOT EXISTS idx_search_filters_tenant ON search_filters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_filters_active ON search_filters(tenant_id, is_active, sort_order) WHERE is_active = true;

-- ==========================================
-- SEARCH CONFIGS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS search_configs (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    language VARCHAR(10) DEFAULT 'english',
    stopwords TEXT[],
    created_at TIMESTAMP DEFAULT NOW()
);

-- ==========================================
-- TRIGGER FUNCTION FOR SEARCH VECTOR
-- ==========================================
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B') ||
        setweight(to_tsvector('english', array_to_string(COALESCE(NEW.keywords, ARRAY[]::TEXT[]), ' ')), 'C');
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- TRIGGER FOR SEARCH VECTOR UPDATE
-- ==========================================
DROP TRIGGER IF EXISTS trigger_update_search_vector ON search_indexes;
CREATE TRIGGER trigger_update_search_vector
    BEFORE INSERT OR UPDATE ON search_indexes
    FOR EACH ROW
    EXECUTE FUNCTION update_search_vector();

-- ==========================================
-- UPDATE TIMESTAMP TRIGGERS
-- ==========================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_search_synonyms_updated_at ON search_synonyms;
CREATE TRIGGER trigger_search_synonyms_updated_at
    BEFORE UPDATE ON search_synonyms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_search_filters_updated_at ON search_filters;
CREATE TRIGGER trigger_search_filters_updated_at
    BEFORE UPDATE ON search_filters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ==========================================
-- COMMENTS FOR DOCUMENTATION
-- ==========================================
COMMENT ON TABLE search_indexes IS 'Main search index for all searchable content';
COMMENT ON COLUMN search_indexes.content_type IS 'Type of content: product, category, page';
COMMENT ON COLUMN search_indexes.search_vector IS 'PostgreSQL tsvector for full-text search';
COMMENT ON COLUMN search_indexes.metadata IS 'Flexible JSONB metadata for filtering (price, category_ids, etc.)';

COMMENT ON TABLE search_synonyms IS 'Search synonym mappings for query expansion';
COMMENT ON COLUMN search_synonyms.synonyms IS 'Array of synonyms for the term';

COMMENT ON TABLE search_analytics IS 'Search query analytics and tracking';
COMMENT ON COLUMN search_analytics.filters IS 'JSONB object containing applied filters';
COMMENT ON COLUMN search_analytics.clicked_result_id IS 'ID of result clicked by user';

COMMENT ON TABLE search_filters IS 'Configurable filter definitions for faceted search';
COMMENT ON COLUMN search_filters.filter_key IS 'Unique key for filter (e.g., price, category, attribute.color)';
COMMENT ON COLUMN search_filters.filter_type IS 'Type: range, select, multiselect, boolean';
COMMENT ON COLUMN search_filters.config IS 'Filter-specific configuration (min/max, options, etc.)';
