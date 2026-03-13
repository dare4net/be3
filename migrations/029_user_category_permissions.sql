-- Migration: User Category Permissions
-- Allows restricting users to specific categories

-- User Category Permissions Table
CREATE TABLE IF NOT EXISTS user_category_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Ensure a user can't have duplicate category assignments
  CONSTRAINT unique_user_category UNIQUE (tenant_id, user_id, category_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_category_permissions_tenant_id ON user_category_permissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_category_permissions_user_id ON user_category_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_category_permissions_category_id ON user_category_permissions(category_id);

-- Comments
COMMENT ON TABLE user_category_permissions IS 'Category-level access control for users. If a user has NO entries, they can access ALL categories. If they have ANY entries, they can ONLY access those specific categories.';
COMMENT ON COLUMN user_category_permissions.user_id IS 'User who has access to this category';
COMMENT ON COLUMN user_category_permissions.category_id IS 'Category the user can access';
