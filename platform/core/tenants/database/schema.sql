-- Tenants Module Schema
-- PRINCIPLE: Multi-tenant by default - this is the foundation table
-- PRINCIPLE: No cross-module database foreign keys

-- Tenants Table
-- This is the core table that all other tenant-scoped tables reference
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(100) NOT NULL UNIQUE,
  domain VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
  settings JSONB DEFAULT '{}',
  logo_url VARCHAR(500),
  timezone VARCHAR(50) DEFAULT 'UTC',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  trial_ends_at TIMESTAMP,
  deleted_at TIMESTAMP
);

-- Indexes
CREATE INDEX idx_tenants_subdomain ON tenants(subdomain);
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_created_at ON tenants(created_at DESC);

-- Comments
COMMENT ON TABLE tenants IS 'Core tenant table - all tenant-scoped tables reference this via tenant_id';
COMMENT ON COLUMN tenants.subdomain IS 'Unique subdomain for tenant (e.g., acme.platform.com)';
COMMENT ON COLUMN tenants.settings IS 'JSON settings for tenant configuration';
