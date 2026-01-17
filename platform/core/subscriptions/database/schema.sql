-- Subscriptions Module Schema
-- PRINCIPLE: Multi-tenant by default
-- PRINCIPLE: No cross-module database foreign keys
-- PRINCIPLE: All feature access is subscription-gated

-- Subscription Plans Table
-- Not tenant-scoped - these are platform-wide plans
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  price_monthly DECIMAL(10, 2) NOT NULL,
  price_yearly DECIMAL(10, 2),
  features JSONB DEFAULT '{}',
  max_users INTEGER,
  max_products INTEGER,
  max_orders_per_month INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  is_public BOOLEAN DEFAULT TRUE,
  trial_days INTEGER DEFAULT 14,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Plan-Module Mapping
-- Defines which modules are included in each plan
-- PRINCIPLE: All feature access is subscription-gated
CREATE TABLE IF NOT EXISTS plan_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL,
  module_name VARCHAR(100) NOT NULL, -- e.g., 'products', 'cart'
  is_enabled BOOLEAN DEFAULT TRUE,
  limits JSONB DEFAULT '{}', -- Module-specific limits
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_plan_module UNIQUE (plan_id, module_name)
);

-- Tenant Subscriptions
-- PRINCIPLE: Multi-tenant by default
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing', 'expired')),
  started_at TIMESTAMP DEFAULT NOW(),
  current_period_start TIMESTAMP DEFAULT NOW(),
  current_period_end TIMESTAMP,
  cancel_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  trial_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tenant Module Overrides
-- PRINCIPLE: All feature access is subscription-gated
-- Allows enabling/disabling specific modules for a tenant beyond their plan
CREATE TABLE IF NOT EXISTS tenant_module_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  module_name VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN NOT NULL,
  reason TEXT, -- Why this override was applied
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID, -- User who created override
  
  CONSTRAINT unique_tenant_module_override UNIQUE (tenant_id, module_name)
);

-- Indexes
CREATE INDEX idx_subscription_plans_name ON subscription_plans(name);
CREATE INDEX idx_subscription_plans_active ON subscription_plans(is_active, is_public);
CREATE INDEX idx_plan_modules_plan_id ON plan_modules(plan_id);
CREATE INDEX idx_plan_modules_module_name ON plan_modules(module_name);
CREATE INDEX idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_plan_id ON subscriptions(plan_id);
CREATE INDEX idx_tenant_module_overrides_tenant_id ON tenant_module_overrides(tenant_id);

-- Comments
COMMENT ON TABLE subscription_plans IS 'Platform-wide subscription plans';
COMMENT ON TABLE plan_modules IS 'Module access configuration per plan';
COMMENT ON TABLE subscriptions IS 'Tenant subscriptions';
COMMENT ON TABLE tenant_module_overrides IS 'Per-tenant module access overrides';
COMMENT ON COLUMN plan_modules.module_name IS 'Name of module (e.g., products, cart, payments)';
