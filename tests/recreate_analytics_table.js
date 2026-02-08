const { query } = require('../config/database');

async function recreate() {
    console.log('🗑️ Dropping existing analytics_events table...');
    try {
        await query('DROP TABLE IF EXISTS analytics_events CASCADE');

        console.log('🏗️ Creating analytics_events table with correct schema...');
        await query(`
            CREATE TABLE analytics_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                entity_type VARCHAR(50) NOT NULL,
                entity_id VARCHAR(255) NOT NULL,
                user_id UUID,
                session_id VARCHAR(255),
                ip_address VARCHAR(45),
                user_agent TEXT,
                placement_id VARCHAR(255),
                placement_type VARCHAR(50),
                position INTEGER,
                referrer_entity_type VARCHAR(50),
                referrer_entity_id VARCHAR(255),
                referrer_url TEXT,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        console.log('📊 Adding indexes...');
        await query('CREATE INDEX idx_analytics_events_tenant_time ON analytics_events(tenant_id, created_at DESC)');
        await query('CREATE INDEX idx_analytics_events_type ON analytics_events(tenant_id, event_type)');
        await query('CREATE INDEX idx_analytics_events_entity ON analytics_events(tenant_id, entity_type, entity_id)');
        await query('CREATE INDEX idx_analytics_events_session ON analytics_events(session_id)');

        console.log('✅ Table recreated successfully!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Reconstruction failed:', e.message);
        process.exit(1);
    }
}

recreate();
