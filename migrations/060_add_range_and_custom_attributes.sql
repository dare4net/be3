-- Migration: Add Range Attribute Type and Dropdown Free-text Support

-- 1. Add allow_custom to attributes table for dropdown free-text support
ALTER TABLE attributes ADD COLUMN IF NOT EXISTS allow_custom BOOLEAN DEFAULT FALSE;

-- 2. Update index for performance on custom attributes if needed
CREATE INDEX IF NOT EXISTS idx_attributes_allow_custom ON attributes(allow_custom);

COMMENT ON COLUMN attributes.allow_custom IS 'If true, dropdown/select attributes allow users to enter custom text values not in the predefined options.';
