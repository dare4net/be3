-- Roles & Permissions Module Schema
-- PRINCIPLE: Multi-tenant by default - all tables have tenant_id
-- PRINCIPLE: No cross-module database foreign keys

-- Roles Table
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE, -- System roles can't be deleted
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_role_name_per_tenant UNIQUE (tenant_id, name)
);

-- Permissions Table
-- Global permissions registry (not tenant-scoped as permissions are universal)
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE, -- e.g., 'products.create'
  module VARCHAR(100) NOT NULL, -- e.g., 'products'
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Role-Permission Mapping
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  role_id UUID NOT NULL,
  permission_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_role_permission UNIQUE (tenant_id, role_id, permission_id)
);

-- User-Role Mapping
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_user_role UNIQUE (tenant_id, user_id, role_id)
);

-- Indexes
CREATE INDEX idx_roles_tenant_id ON roles(tenant_id);
CREATE INDEX idx_role_permissions_tenant_id ON role_permissions(tenant_id);
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_user_roles_tenant_id ON user_roles(tenant_id);
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX idx_permissions_module ON permissions(module);

-- Comments
COMMENT ON TABLE roles IS 'Multi-tenant roles for RBAC';
COMMENT ON TABLE permissions IS 'Global permissions registry (not tenant-scoped)';
COMMENT ON TABLE role_permissions IS 'Role-permission mappings (tenant-scoped)';
COMMENT ON TABLE user_roles IS 'User-role assignments (tenant-scoped)';
COMMENT ON COLUMN permissions.name IS 'Permission identifier, e.g., products.create';
