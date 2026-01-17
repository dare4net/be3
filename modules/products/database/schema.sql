-- Products Module Schema
-- PRINCIPLE: Multi-tenant by default - all tables have tenant_id
-- PRINCIPLE: No cross-module database foreign keys

-- Products Table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sku VARCHAR(100),
  price DECIMAL(10, 2) NOT NULL,
  compare_at_price DECIMAL(10, 2),
  cost DECIMAL(10, 2),
  track_inventory BOOLEAN DEFAULT TRUE,
  inventory_quantity INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,
  
  CONSTRAINT unique_sku_per_tenant UNIQUE (tenant_id, sku)
);

-- Product Variants Table
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  product_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100),
  price DECIMAL(10, 2),
  inventory_quantity INTEGER DEFAULT 0,
  option1_name VARCHAR(100), -- e.g., "Size"
  option1_value VARCHAR(100), -- e.g., "Large"
  option2_name VARCHAR(100), -- e.g., "Color"
  option2_value VARCHAR(100), -- e.g., "Red"
  option3_name VARCHAR(100),
  option3_value VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Product Media Table
CREATE TABLE IF NOT EXISTS product_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  product_id UUID NOT NULL,
  url VARCHAR(500) NOT NULL,
  media_type VARCHAR(20) DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  position INTEGER DEFAULT 0,
  alt_text VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_products_tenant_id ON products(tenant_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_product_variants_tenant_id ON product_variants(tenant_id);
CREATE INDEX idx_product_variants_product_id ON product_variants(product_id);
CREATE INDEX idx_product_media_tenant_id ON product_media(tenant_id);
CREATE INDEX idx_product_media_product_id ON product_media(product_id);

-- Comments
COMMENT ON TABLE products IS 'Multi-tenant product catalog';
COMMENT ON TABLE product_variants IS 'Product variations (size, color, etc.)';
COMMENT ON TABLE product_media IS 'Product images and videos';
