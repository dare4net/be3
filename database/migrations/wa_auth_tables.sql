-- ============================================================
-- WA Auth Tables
-- WhatsApp phone binding + magic link authentication
-- ============================================================

-- Pending phone verifications (short-lived, 10 min TTL)
CREATE TABLE IF NOT EXISTS wa_verifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    user_id     UUID        NOT NULL,
    phone       TEXT        NOT NULL,       -- E.164 e.g. 2348012345678
    code        TEXT        NOT NULL,       -- e.g. BE3-7X9K
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_verifications_code   ON wa_verifications (code);
CREATE INDEX IF NOT EXISTS idx_wa_verifications_phone  ON wa_verifications (phone);
CREATE INDEX IF NOT EXISTS idx_wa_verifications_expiry ON wa_verifications (expires_at);

-- Permanent WA <-> User bindings (one row per linked number)
CREATE TABLE IF NOT EXISTS wa_sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    user_id      UUID        NOT NULL,
    wa_phone     TEXT        NOT NULL,      -- verified WA number (E.164)
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, wa_phone)            -- one account per number per tenant
);

CREATE INDEX IF NOT EXISTS idx_wa_sessions_user  ON wa_sessions (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_wa_sessions_phone ON wa_sessions (tenant_id, wa_phone);

-- One-time magic link tokens (15 min TTL, single-use)
CREATE TABLE IF NOT EXISTS magic_tokens (
    token       TEXT        PRIMARY KEY,
    tenant_id   UUID        NOT NULL,
    user_id     UUID        NOT NULL,
    wa_phone    TEXT        NOT NULL,
    destination TEXT,                       -- redirect path after auth
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magic_tokens_expiry ON magic_tokens (expires_at);
