-- Migration: Decoupled Attributes
-- Move from JSONB Schema to Relational Attributes

-- 1. Global Attributes Table
CREATE TABLE IF NOT EXISTS attributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  code VARCHAR(100) NOT NULL, -- e.g. "size"
  label VARCHAR(255) NOT NULL, -- e.g. "Size"
  type VARCHAR(50) NOT NULL, -- "text", "number", "select", "multiselect"
  options JSONB, -- For select types: ["S", "M", "L"] or [{"label": "Small", "value": "S"}]
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_attribute_code_per_tenant UNIQUE (tenant_id, code)
);

-- 2. Category-Attributes Mapping (Many-to-Many)
CREATE TABLE IF NOT EXISTS category_attributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  attribute_id UUID NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  is_required BOOLEAN DEFAULT FALSE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_category_attribute UNIQUE (category_id, attribute_id)
);

-- Indexes
CREATE INDEX idx_attributes_tenant_id ON attributes(tenant_id);
CREATE INDEX idx_category_attributes_category_id ON category_attributes(category_id);
