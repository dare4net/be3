-- Migration: Add Collections System
-- Creates the collections table and necessary indexes

CREATE TABLE IF NOT EXISTS collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    image_url VARCHAR(500),
    rules JSONB DEFAULT '[]', -- Array of rule objects
    manual_product_ids UUID[] DEFAULT '{}', -- Explicitly included products
    excluded_product_ids UUID[] DEFAULT '{}', -- Explicitly excluded products
    seo JSONB DEFAULT '{}', -- SEO metadata (title, description, etc.)
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT unique_collection_slug_per_tenant UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_collections_tenant_id ON collections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_collections_slug ON collections(slug);
CREATE INDEX IF NOT EXISTS idx_collections_active ON collections(tenant_id, is_active) WHERE is_active = true;

-- Add tags index to search_indexes metadata for faster faceted search
-- Note: idx_search_indexes_metadata already exists, but we can add a specific GIN index for keys if needed.

COMMENT ON TABLE collections IS 'Rule-based product groupings (Dynamic Collections)';
COMMENT ON COLUMN collections.rules IS 'JSONB array of rules: [{"field": "tag", "operator": "contains", "value": "summer"}]';
