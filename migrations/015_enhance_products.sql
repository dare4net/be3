-- Enhance Products Table for Better Management
-- Adds featured flag, tags, SEO fields, and handle/slug

-- Add new columns to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS seo_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS seo_description TEXT,
ADD COLUMN IF NOT EXISTS handle VARCHAR(255),
ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(tenant_id, is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_products_handle ON products(tenant_id, handle);
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN(tags);

-- Update existing products to have handles generated from names + ID for uniqueness
UPDATE products 
SET handle = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g')) 
            || '-' || SUBSTRING(id::text, 1, 8)
WHERE handle IS NULL;

-- Add unique constraint on handle per tenant (for SEO-friendly URLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_unique_handle 
ON products(tenant_id, handle) 
WHERE handle IS NOT NULL;
