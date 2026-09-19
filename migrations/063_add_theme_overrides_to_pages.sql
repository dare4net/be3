-- Add theme overrides to pages table
ALTER TABLE pages 
ADD COLUMN IF NOT EXISTS theme_overrides JSONB DEFAULT '{}';

COMMENT ON COLUMN pages.theme_overrides IS 'JSON object containing color, font, and style overrides for this specific page';
