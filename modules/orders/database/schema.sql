-- Orders Module Schema
-- PRINCIPLE: Multi-tenant by default
-- PRINCIPLE: No cross-module database foreign keys

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID,
  session_id VARCHAR(255),
  order_number VARCHAR(50) NOT NULL,

  -- Operational status: fulfillment lifecycle only.
  -- Payment-domain values (paid, refunded) are intentionally excluded — see payment_status.
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'returned', 'cancelled')),

  -- Financial status: tracks money, not fulfillment.
  -- 'fulfilled' = vendor manually confirmed off-platform payment (WhatsApp / DM).
  payment_status VARCHAR(20) DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'processing', 'paid', 'failed', 'fulfilled', 'refunded')),

  -- Checkout channel: determines which payment flows are valid.
  checkout_type VARCHAR(20) DEFAULT 'platform'
    CHECK (checkout_type IN ('platform', 'whatsapp')),

  subtotal DECIMAL(10, 2) NOT NULL,
  discount_amount DECIMAL(10, 2) DEFAULT 0,
  tax_amount DECIMAL(10, 2) DEFAULT 0,
  shipping_amount DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'NGN',

  customer_email VARCHAR(255),
  customer_name VARCHAR(255),
  shipping_address JSONB,
  billing_address JSONB,
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  -- Audit trail for manual payment confirmation by vendor
  confirmed_by UUID,               -- vendor user_id who manually confirmed
  payment_confirmed_at TIMESTAMP,  -- when they confirmed

  -- Reference to Paystack transaction (platform orders)
  paystack_reference VARCHAR(255),

  -- Vendor scope
  vendor_id UUID,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  shipped_at TIMESTAMP,
  delivered_at TIMESTAMP,
  cancelled_at TIMESTAMP,

  CONSTRAINT unique_order_number_per_tenant UNIQUE (tenant_id, order_number)
);

-- Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL,
  product_id UUID NOT NULL, -- Reference only, not FK
  variant_id UUID,
  product_name VARCHAR(255) NOT NULL, -- Snapshot at time of purchase
  sku VARCHAR(100),
  quantity INTEGER NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  image_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Refunds Table (label only for now — dispute module pending)
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  order_id UUID NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_session_id ON orders(session_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_session ON orders(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_checkout_type ON orders(checkout_type);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant_id ON order_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(order_id);

-- Comments
COMMENT ON TABLE orders IS 'Customer orders — all channels (platform + WhatsApp)';
COMMENT ON COLUMN orders.status IS 'Operational/fulfillment lifecycle: pending → processing → shipped → delivered';
COMMENT ON COLUMN orders.payment_status IS 'Financial lifecycle: unpaid → paid (platform) or fulfilled (manual vendor confirm)';
COMMENT ON COLUMN orders.checkout_type IS 'platform = Paystack, whatsapp = DM handoff';
COMMENT ON COLUMN orders.confirmed_by IS 'Vendor user_id who manually confirmed off-platform payment';
COMMENT ON TABLE order_items IS 'Order line items with product snapshots';
COMMENT ON COLUMN order_items.product_name IS 'Snapshot of product name at purchase time';
