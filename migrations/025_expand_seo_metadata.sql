-- SEO Metadata Expansion
-- Adds comprehensive SEO fields to pages table following Open Graph and Twitter Card standards

-- Add SEO fields to pages table
ALTER TABLE pages
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
    ADD COLUMN IF NOT EXISTS structured_data JSONB; -- For JSON-LD schema.org markup

-- Add comments for documentation
COMMENT ON COLUMN pages.og_title IS 'Open Graph title (Facebook/LinkedIn sharing)';
COMMENT ON COLUMN pages.og_description IS 'Open Graph description';
COMMENT ON COLUMN pages.og_image IS 'Open Graph image URL (recommended 1200x630)';
COMMENT ON COLUMN pages.og_type IS 'Open Graph type: website, article, product, etc.';
COMMENT ON COLUMN pages.twitter_card IS 'Twitter Card type: summary, summary_large_image, app, player';
COMMENT ON COLUMN pages.canonical_url IS 'Canonical URL for duplicate content handling';
COMMENT ON COLUMN pages.robots IS 'Robots meta directive: index,follow | noindex,follow | etc.';
COMMENT ON COLUMN pages.structured_data IS 'JSON-LD structured data for rich snippets';

-- Create SEO presets table (reusable SEO templates)
CREATE TABLE IF NOT EXISTS seo_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    og_image TEXT,
    og_type VARCHAR(50) DEFAULT 'website',
    twitter_card VARCHAR(20) DEFAULT 'summary_large_image',
    robots VARCHAR(100) DEFAULT 'index,follow',
    structured_data JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_presets_tenant ON seo_presets(tenant_id);

-- Update trigger for seo_presets
CREATE OR REPLACE FUNCTION update_seo_presets_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_seo_presets_timestamp
    BEFORE UPDATE ON seo_presets
    FOR EACH ROW
    EXECUTE FUNCTION update_seo_presets_timestamp();

-- Backfill: Set default OG values from existing meta_description and title
UPDATE pages SET 
    og_title = title,
    og_description = meta_description,
    twitter_title = title,
    twitter_description = meta_description
WHERE og_title IS NULL OR og_description IS NULL;
