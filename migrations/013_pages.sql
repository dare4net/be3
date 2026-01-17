-- Page Management: Pages Table
-- Stores custom pages with SEO and navigation settings

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    meta_description TEXT,
    is_published BOOLEAN DEFAULT false,
    show_in_nav BOOLEAN DEFAULT false,
    is_system BOOLEAN DEFAULT false, -- System pages like 'home' cannot be deleted
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_tenant_slug UNIQUE(tenant_id, slug)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pages_tenant ON pages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_pages_published ON pages(tenant_id, is_published);

-- Update trigger
CREATE OR REPLACE FUNCTION update_pages_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_pages_timestamp
    BEFORE UPDATE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION update_pages_timestamp();
