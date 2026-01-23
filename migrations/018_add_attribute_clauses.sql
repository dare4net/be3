-- Add clauses column to attributes table
ALTER TABLE attributes ADD COLUMN IF NOT EXISTS clauses JSONB DEFAULT '[]'::jsonb;

-- Update existing rows to have empty array if null (though DEFAULT should handle it for new)
UPDATE attributes SET clauses = '[]'::jsonb WHERE clauses IS NULL;
