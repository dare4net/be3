-- Migration: Add whats_included column to products
-- This stores the list of items included with the product
ALTER TABLE products ADD COLUMN IF NOT EXISTS whats_included TEXT[] DEFAULT '{}';
