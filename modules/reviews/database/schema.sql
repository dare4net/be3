-- Reviews Module Schema
-- PRINCIPLE: Multi-tenant by default - all tables have tenant_id
-- PRINCIPLE: No cross-module database foreign keys

-- ============================================================
-- RATINGS: One per user per product (the star score)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  product_id UUID NOT NULL,
  user_id UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- One rating per user per product per tenant
  CONSTRAINT unique_rating_per_user_product UNIQUE (tenant_id, product_id, user_id)
);

-- ============================================================
-- REVIEWS: Many per user per product (text feedback)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  product_id UUID NOT NULL,
  user_id UUID NOT NULL,
  
  -- Content
  title VARCHAR(255),
  body TEXT NOT NULL,
  
  -- Verification
  is_verified_purchase BOOLEAN DEFAULT FALSE,
  
  -- Moderation (deferred — default published)
  status VARCHAR(20) DEFAULT 'published',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- ============================================================
-- REVIEW MEDIA: Compressed images attached to reviews (max 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS review_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  review_id UUID NOT NULL,
  url VARCHAR(500) NOT NULL,
  media_type VARCHAR(20) DEFAULT 'image',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- HELPFUL VOTES: One per user per review (toggle)
-- ============================================================
CREATE TABLE IF NOT EXISTS review_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  review_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_vote_per_user_review UNIQUE (tenant_id, review_id, user_id)
);

-- ============================================================
-- VENDOR REPLIES: One per vendor per review
-- ============================================================
CREATE TABLE IF NOT EXISTS review_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  review_id UUID NOT NULL,
  vendor_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT unique_reply_per_vendor_review UNIQUE (tenant_id, review_id, vendor_id)
);

-- ============================================================
-- RATING SUMMARY CACHE: Denormalized for fast reads
-- ============================================================
CREATE TABLE IF NOT EXISTS product_rating_summary (
  tenant_id UUID NOT NULL,
  product_id UUID NOT NULL,
  average_rating DECIMAL(2,1) DEFAULT 0,
  total_ratings INTEGER DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  rating_1 INTEGER DEFAULT 0,
  rating_2 INTEGER DEFAULT 0,
  rating_3 INTEGER DEFAULT 0,
  rating_4 INTEGER DEFAULT 0,
  rating_5 INTEGER DEFAULT 0,
  last_updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (tenant_id, product_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_product_ratings_tenant_product ON product_ratings(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_ratings_user ON product_ratings(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_tenant_product ON product_reviews(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_user ON product_reviews(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_status ON product_reviews(status);
CREATE INDEX IF NOT EXISTS idx_review_media_review ON review_media(review_id);
CREATE INDEX IF NOT EXISTS idx_review_votes_review ON review_votes(review_id);
CREATE INDEX IF NOT EXISTS idx_review_replies_review ON review_replies(review_id);

-- Comments
COMMENT ON TABLE product_ratings IS 'One rating (1-5 stars) per user per product';
COMMENT ON TABLE product_reviews IS 'Text reviews, many per user per product';
COMMENT ON TABLE review_media IS 'Images attached to reviews (max 4 per review)';
COMMENT ON TABLE review_votes IS 'Helpful vote toggle, one per user per review';
COMMENT ON TABLE review_replies IS 'Vendor reply to a review, one per vendor per review';
COMMENT ON TABLE product_rating_summary IS 'Denormalized rating aggregation cache';
