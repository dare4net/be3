-- Migration: Add Product Attributes (Custom Fields)
-- Uses JSONB for flexible schema definition + GIN indexing for search

-- 1. Add Schema Definition to Categories
-- Defines WHAT fields exist (e.g., "Screen Size", "RAM")
ALTER TABLE categories ADD COLUMN IF NOT EXISTS attributes_schema JSONB DEFAULT '[]';

-- 2. Add Attribute Values to Products
-- Stores the ACTUAL values (e.g., "M3 Pro", "16GB")
ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}';

-- 3. GIN Index for High-Performance Filtering
-- Allows queries like: SELECT * FROM products WHERE attributes @> '{"ram": "16GB"}'
CREATE INDEX IF NOT EXISTS idx_products_attributes ON products USING GIN (attributes);
