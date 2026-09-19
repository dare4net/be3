-- Migration: Add whats_included column to products
-- Stores the list of items included with the product
ALTER TABLE products ADD COLUMN IF NOT EXISTS whats_included TEXT[] DEFAULT '{}';
