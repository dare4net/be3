-- Allow super admin to exempt tenants from rate limiting
-- Idempotent: safe to run multiple times

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rate_limit_exempt BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.rate_limit_exempt IS 'When true, all requests for this tenant skip the global rate limiter. Managed from super admin.';
