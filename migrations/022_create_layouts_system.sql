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

-- 2. Backfill: Create 'Default' layout for every existing tenant (only if doesn't exist)
INSERT INTO layouts (tenant_id, name, is_active, description)
SELECT id, 'Default', true, 'Automatically created default layout'
FROM tenants
WHERE NOT EXISTS (
    SELECT 1 FROM layouts l WHERE l.tenant_id = tenants.id AND l.name = 'Default'
);

-- 3. Add layout_id to page_widgets
ALTER TABLE page_widgets ADD COLUMN IF NOT EXISTS layout_id UUID;

-- 4. Backfill: Link existing widgets to the new Default layout of their tenant (only if layout_id is NULL)
UPDATE page_widgets pw
SET layout_id = l.id
FROM layouts l
WHERE pw.tenant_id = l.tenant_id
  AND l.name = 'Default'
  AND pw.layout_id IS NULL;

-- 5. Enforce Constraints (after backfill)
-- Set NOT NULL only if column is nullable
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'page_widgets' 
        AND column_name = 'layout_id' 
        AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE page_widgets ALTER COLUMN layout_id SET NOT NULL;
    END IF;
END $$;

-- Add foreign key constraint only if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_page_widgets_layout'
    ) THEN
        ALTER TABLE page_widgets
        ADD CONSTRAINT fk_page_widgets_layout 
        FOREIGN KEY (layout_id) REFERENCES layouts(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 6. Add Index for performance
CREATE INDEX IF NOT EXISTS idx_page_widgets_layout ON page_widgets(layout_id);
