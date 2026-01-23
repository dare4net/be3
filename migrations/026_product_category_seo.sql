-- Extend SEO Metadata to Products and Categories
-- Adds comprehensive SEO fields matching pages table structure
-- Supports inheritance: products inherit from category SEO (if null)

-- ==== CATEGORIES TABLE ====
-- First, ensure categories table exists (if not created yet by another migration)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    image_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);

-- Add SEO fields to categories
ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS meta_description TEXT,
    ADD COLUMN IF NOT EXISTS og_title VARCHAR(255),
    ADD COLUMN IF NOT EXISTS og_description TEXT,
    ADD COLUMN IF NOT EXISTS og_image TEXT,
    ADD COLUMN IF NOT EXISTS og_type VARCHAR(50) DEFAULT 'website',
    ADD COLUMN IF NOT EXISTS twitter_card VARCHAR(20) DEFAULT 'summary_large_image',
    ADD COLUMN IF NOT EXISTS twitter_title VARCHAR(255),
    ADD COLUMN IF NOT EXISTS twitter_description TEXT,
    ADD COLUMN IF NOT EXISTS twitter_image TEXT,
    ADD COLUMN IF NOT EXISTS canonical_url TEXT,
    ADD COLUMN IF NOT EXISTS robots VARCHAR(100) DEFAULT 'index,follow',
    ADD COLUMN IF NOT EXISTS structured_data JSONB;

-- Comments for documentation
COMMENT ON COLUMN categories.og_type IS 'Use "product.group" for category pages';
COMMENT ON COLUMN categories.structured_data IS 'Schema.org CollectionPage or ItemList for category listings';

-- ==== PRODUCTS TABLE ====
-- Expand existing seo_title/seo_description to full SEO suite
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS category_id UUID, -- For SEO inheritance
    ADD COLUMN IF NOT EXISTS meta_description TEXT, -- New comprehensive field
    ADD COLUMN IF NOT EXISTS og_title VARCHAR(255),
    ADD COLUMN IF NOT EXISTS og_description TEXT,
    ADD COLUMN IF NOT EXISTS og_image TEXT,
    ADD COLUMN IF NOT EXISTS og_type VARCHAR(50) DEFAULT 'product',
    ADD COLUMN IF NOT EXISTS twitter_card VARCHAR(20) DEFAULT 'summary_large_image',
    ADD COLUMN IF NOT EXISTS twitter_title VARCHAR(255),
    ADD COLUMN IF NOT EXISTS twitter_description TEXT,
    ADD COLUMN IF NOT EXISTS twitter_image TEXT,
    ADD COLUMN IF NOT EXISTS canonical_url TEXT,
    ADD COLUMN IF NOT EXISTS robots VARCHAR(100) DEFAULT 'index,follow',
    ADD COLUMN IF NOT EXISTS structured_data JSONB;

-- Backfill meta_description from seo_description if present
UPDATE products 
SET meta_description = seo_description 
WHERE meta_description IS NULL AND seo_description IS NOT NULL;

-- Backfill og_title from seo_title if present
UPDATE products 
SET og_title = seo_title 
WHERE og_title IS NULL AND seo_title IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN products.category_id IS 'Primary category for SEO inheritance';
COMMENT ON COLUMN products.og_type IS 'Should always be "product" for product pages';
COMMENT ON COLUMN products.structured_data IS 'Schema.org Product schema with price, availability, brand, etc.';

-- Create index for category relationship
CREATE INDEX IF NOT EXISTS idx_products_category ON products(tenant_id, category_id) WHERE category_id IS NOT NULL;

-- ==== PRODUCT-CATEGORY JUNCTION (if many-to-many needed) ====
-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL,
    category_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(product_id, category_id)
);

-- Add new columns if they don't exist
ALTER TABLE product_categories
    ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_product_categories_product ON product_categories(product_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category ON product_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_primary ON product_categories(tenant_id, is_primary) WHERE is_primary = true;

COMMENT ON TABLE product_categories IS 'Many-to-many: products can be in multiple categories';
COMMENT ON COLUMN product_categories.is_primary IS 'Primary category used for SEO inheritance';
