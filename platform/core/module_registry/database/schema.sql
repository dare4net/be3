-- Module Registry Schema
-- PRINCIPLE: Multi-tenant by default - track which modules are enabled per tenant
-- PRINCIPLE: Any module can be removed without crashing the system

-- Modules Catalog (global)
-- Registry of all available modules
CREATE TABLE IF NOT EXISTS modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  version VARCHAR(20) NOT NULL,
  is_core BOOLEAN DEFAULT FALSE,
  dependencies JSONB DEFAULT '[]', -- Array of module names this depends on
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tenant Modules (tenant-scoped)
-- PRINCIPLE: Multi-tenant by default
-- Track which modules are enabled for each tenant
CREATE TABLE IF NOT EXISTS tenant_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  module_name VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN DEFAULT TRUE,
  enabled_at TIMESTAMP DEFAULT NOW(),
  disabled_at TIMESTAMP,
  configuration JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_tenant_module UNIQUE (tenant_id, module_name)
);

-- Indexes
CREATE INDEX idx_modules_name ON modules(name);
CREATE INDEX idx_tenant_modules_tenant_id ON tenant_modules(tenant_id);
CREATE INDEX idx_tenant_modules_enabled ON tenant_modules(tenant_id, is_enabled);

-- Comments
COMMENT ON TABLE modules IS 'Global catalog of available modules';
COMMENT ON TABLE tenant_modules IS 'Per-tenant module enablement tracking';
COMMENT ON COLUMN modules.dependencies IS 'JSON array of required module names';
