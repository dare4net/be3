-- Migration: Add Product Variants Support
-- Adds parent_id, is_variant, and variant_label to the products table

-- 1. Add columns to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES products(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS is_variant BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS variant_label VARCHAR(255);

-- 2. Add index for parent_id to speed up variant lookups
CREATE INDEX IF NOT EXISTS idx_products_parent_id ON products(parent_id);

-- 3. Add comment
COMMENT ON COLUMN products.parent_id IS 'References the base product if this is a variant';
COMMENT ON COLUMN products.variant_label IS 'Label for the variant (e.g., Red, 8GB, etc.)';
