-- Create attributes table
CREATE TABLE IF NOT EXISTS attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(255) NOT NULL,
    label VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('text', 'number', 'select', 'multiselect', 'boolean')),
    options JSONB, -- For select/multiselect values
    is_filterable BOOLEAN DEFAULT false,
    is_searchable BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- Create category_attributes table
CREATE TABLE IF NOT EXISTS category_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL, -- Denormalized for easy tenant isolation
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
    is_required BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(category_id, attribute_id)
);

-- Add indexes
CREATE INDEX idx_attributes_tenant ON attributes(tenant_id);
CREATE INDEX idx_cat_attr_category ON category_attributes(category_id);
CREATE INDEX idx_cat_attr_tenant ON category_attributes(tenant_id);
