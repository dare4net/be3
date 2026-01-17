-- Marketing Module Schema
-- PRINCIPLE: Multi-tenant by default

-- Campaigns
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  content TEXT, -- Email body
  status VARCHAR(50) DEFAULT 'draft', -- draft, scheduled, sent
  scheduled_at TIMESTAMP,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Campaign Logs (Who received it)
CREATE TABLE IF NOT EXISTS campaign_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  campaign_id UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  user_email VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'sent', -- sent, opened, clicked
  sent_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_campaigns_tenant ON marketing_campaigns(tenant_id);
CREATE INDEX idx_campaign_logs_campaign ON campaign_logs(campaign_id);
