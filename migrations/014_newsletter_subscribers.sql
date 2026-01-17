-- Newsletter Subscriptions Table

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'active', -- active, unsubscribed
    subscribed_at TIMESTAMP DEFAULT NOW(),
    unsubscribed_at TIMESTAMP,
    CONSTRAINT unique_tenant_email UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_tenant ON newsletter_subscribers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_newsletter_status ON newsletter_subscribers(tenant_id, status);
