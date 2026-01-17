-- Fix Coupons Table
-- Ensure all columns exist (idempotent)

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS usage_limit INTEGER;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS used_count INTEGER DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS min_order_amount DECIMAL(10, 2);
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
