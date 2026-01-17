-- Cart Module Schema
-- PRINCIPLE: Multi-tenant by default
-- PRINCIPLE: No cross-module database foreign keys (stores product_id as UUID reference but not FK)

-- Carts Table
CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID, -- NULL for guest carts
  session_id VARCHAR(255), -- For guest cart tracking
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'abandoned', 'completed')),
  subtotal DECIMAL(10, 2) DEFAULT 0,
  discount_amount DECIMAL(10, 2) DEFAULT 0,
  tax_amount DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) DEFAULT 0,
  coupon_code VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  abandoned_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Cart Items Table
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  cart_id UUID NOT NULL,
  product_id UUID NOT NULL, -- Reference only, not FK (cross-module)
  variant_id UUID,
  quantity INTEGER NOT NULL DEFAULT 1,
  price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Coupons Table
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  code VARCHAR(100) NOT NULL,
  discount_type VARCHAR(20) CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10, 2) NOT NULL,
  min_purchase DECIMAL(10, 2),
  max_uses INTEGER,
  uses_count INTEGER DEFAULT 0,
  starts_at TIMESTAMP,
expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_coupon_code_per_tenant UNIQUE (tenant_id, code)
);

-- Indexes
CREATE INDEX idx_carts_tenant_id ON carts(tenant_id);
CREATE INDEX idx_carts_user_id ON carts(user_id);
CREATE INDEX idx_carts_session_id ON carts(session_id);
CREATE INDEX idx_cart_items_cart_id ON cart_items(cart_id);
CREATE INDEX idx_cart_items_tenant_id ON cart_items(tenant_id);
CREATE INDEX idx_coupons_tenant_id ON coupons(tenant_id);
CREATE INDEX idx_coupons_code ON coupons(code);

-- Comments
COMMENT ON TABLE carts IS 'Shopping carts for guests and authenticated users';
COMMENT ON TABLE cart_items IS 'Items in shopping carts - no FK to products (cross-module)';
COMMENT ON COLUMN cart_items.product_id IS 'Product reference (not FK - cross-module not allowed)';
