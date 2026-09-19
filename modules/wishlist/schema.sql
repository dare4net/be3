-- Wishlist Table Schema
CREATE TABLE IF NOT EXISTS wishlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID, -- Nullable for session-based or future anonymous wishlists
    session_id VARCHAR(255), -- For anonymous users
    product_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB,
    UNIQUE(tenant_id, user_id, product_id), -- Prevent duplicate adds for logged in users
    UNIQUE(tenant_id, session_id, product_id) -- Prevent duplicate adds for anonymous
);

-- Indexes for performance
CREATE INDEX idx_wishlists_user ON wishlists(tenant_id, user_id);
CREATE INDEX idx_wishlists_session ON wishlists(tenant_id, session_id);
CREATE INDEX idx_wishlists_product ON wishlists(tenant_id, product_id);
