-- Advanced Theming: Menus & Layout Settings

-- Menus Table
-- Stores menu definitions (e.g., Main Menu, Footer Menu)
CREATE TABLE IF NOT EXISTS menus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    location VARCHAR(100) NOT NULL, -- e.g., 'header', 'footer_1', 'footer_2', 'sidebar'
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_tenant_menu_location UNIQUE(tenant_id, location)
);

CREATE INDEX IF NOT EXISTS idx_menus_tenant ON menus(tenant_id);

-- Menu Items Table
-- Stores hierarchical menu links
CREATE TABLE IF NOT EXISTS menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_id UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES menu_items(id) ON DELETE CASCADE, -- For nested menus
    label VARCHAR(255) NOT NULL,
    url VARCHAR(500),
    type VARCHAR(50) DEFAULT 'custom', -- 'custom', 'page', 'category', 'product'
    reference_id UUID, -- ID of the Page/Category/Product if type is not custom
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON menu_items(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_parent ON menu_items(parent_id);

-- Add Layout Settings to Pages
ALTER TABLE pages 
ADD COLUMN IF NOT EXISTS show_header BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS show_footer BOOLEAN DEFAULT true;
