const { query } = require('../config/database');

async function recreate() {
    console.log('🗑️ Dropping existing daily_stats table...');
    try {
        await query('DROP TABLE IF EXISTS daily_stats CASCADE');

        console.log('🏗️ Creating daily_stats table with correct schema...');
        await query(`
            CREATE TABLE daily_stats (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL,
                date DATE NOT NULL DEFAULT CURRENT_DATE,
                total_sales DECIMAL(10, 2) DEFAULT 0,
                order_count INTEGER DEFAULT 0,
                new_customers INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(tenant_id, date)
            )
        `);

        console.log('📊 Adding indexes...');
        await query('CREATE INDEX idx_daily_stats_tenant_date ON daily_stats(tenant_id, date DESC)');

        console.log('✅ Table recreated successfully!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Reconstruction failed:', e.message);
        process.exit(1);
    }
}

recreate();
