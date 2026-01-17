-- Layout System Migration
-- creates layouts table and links page_widgets to it

-- 1. Create Layouts Table
CREATE TABLE IF NOT EXISTS layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT false,
    theme_id UUID, -- Optional: link to a specific theme configuration
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layouts_tenant_active ON layouts(tenant_id, is_active);

-- 2. Backfill: Create 'Default' layout for every existing tenant
INSERT INTO layouts (tenant_id, name, is_active, description)
SELECT id, 'Default', true, 'Automatically created default layout'
FROM tenants;

-- 3. Add layout_id to page_widgets
ALTER TABLE page_widgets ADD COLUMN IF NOT EXISTS layout_id UUID;

-- 4. Backfill: Link existing widgets to the new Default layout of their tenant
UPDATE page_widgets pw
SET layout_id = l.id
FROM layouts l
WHERE pw.tenant_id = l.tenant_id
  AND l.name = 'Default';

-- 5. Enforce Constraints (after backfill)
ALTER TABLE page_widgets
    ALTER COLUMN layout_id SET NOT NULL,
    ADD CONSTRAINT fk_page_widgets_layout FOREIGN KEY (layout_id) REFERENCES layouts(id) ON DELETE CASCADE;

-- 6. Add Index for performance
CREATE INDEX IF NOT EXISTS idx_page_widgets_layout ON page_widgets(layout_id);
