-- Payments Module Schema
-- PRINCIPLE: Multi-tenant by default
-- PRINCIPLE: No cross-module database foreign keys

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID, -- Reference only, not FK
  user_id UUID,
  provider VARCHAR(50) NOT NULL, -- 'stripe', 'paypal', etc.
  provider_payment_id VARCHAR(255),
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded')),
  payment_method VARCHAR(50), -- 'card', 'paypal', etc.
  metadata JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  succeeded_at TIMESTAMP,
  failed_at TIMESTAMP
);

-- Payment Providers Configuration
CREATE TABLE IF NOT EXISTS payment_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  provider VARCHAR(50) NOT NULL, -- ' stripe', 'paypal'
  is_enabled BOOLEAN DEFAULT FALSE,
  config JSONB DEFAULT '{}', -- API keys, webhook secrets (encrypted)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_provider_per_tenant UNIQUE (tenant_id, provider)
);

-- Indexes
CREATE INDEX idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_provider_payment_id ON payments(provider_payment_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payment_providers_tenant_id ON payment_providers(tenant_id);

-- Comments
COMMENT ON TABLE payments IS 'Payment transactions';
COMMENT ON TABLE payment_providers IS 'Per-tenant payment provider configuration';
COMMENT ON COLUMN payments.order_id IS 'Order reference (not FK - cross-module)';
