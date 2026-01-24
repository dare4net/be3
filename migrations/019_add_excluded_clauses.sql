-- Add is_ignored and excluded_clauses columns to category_attributes table
ALTER TABLE category_attributes ADD COLUMN IF NOT EXISTS is_ignored BOOLEAN DEFAULT false;
ALTER TABLE category_attributes ADD COLUMN IF NOT EXISTS excluded_clauses JSONB DEFAULT '[]'::jsonb;

-- Update existing rows to have defaults
UPDATE category_attributes SET is_ignored = false WHERE is_ignored IS NULL;
UPDATE category_attributes SET excluded_clauses = '[]'::jsonb WHERE excluded_clauses IS NULL;
