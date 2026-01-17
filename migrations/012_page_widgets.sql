-- Page Builder: Widgets Table
-- Stores customizable widgets for storefront pages

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS page_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    page_type VARCHAR(50) NOT NULL, -- 'home', 'about', 'contact', etc.
    widget_type VARCHAR(50) NOT NULL, -- 'hero', 'product_grid', 'testimonials', etc.
    config JSONB NOT NULL DEFAULT '{}', -- Widget-specific configuration
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_page_widgets_tenant ON page_widgets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_page_widgets_page ON page_widgets(tenant_id, page_type, is_active);
CREATE INDEX IF NOT EXISTS idx_page_widgets_sort ON page_widgets(tenant_id, page_type, sort_order);

-- Update trigger
CREATE OR REPLACE FUNCTION update_page_widgets_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_page_widgets_timestamp
    BEFORE UPDATE ON page_widgets
    FOR EACH ROW
    EXECUTE FUNCTION update_page_widgets_timestamp();
