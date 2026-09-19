const { query } = require('../config/database');

async function migrate() {
    console.log('🚀 Starting analytics_events schema migration...');
    try {
        // 1. Add missing columns safely
        const columns = [
            ['entity_type', 'VARCHAR(50)'],
            ['entity_id', 'VARCHAR(255)'],
            ['ip_address', 'VARCHAR(45)'],
            ['user_agent', 'TEXT'],
            ['placement_id', 'VARCHAR(255)'],
            ['placement_type', 'VARCHAR(50)'],
            ['position', 'INTEGER'],
            ['referrer_entity_type', 'VARCHAR(50)'],
            ['referrer_entity_id', 'VARCHAR(255)'],
            ['referrer_url', 'TEXT']
        ];

        for (const [name, type] of columns) {
            console.log(`Checking column: ${name}...`);
            const check = await query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'analytics_events' AND column_name = $1
            `, [name]);

            if (check.rows.length === 0) {
                console.log(`Adding column: ${name} (${type})`);
                await query(`ALTER TABLE analytics_events ADD COLUMN ${name} ${type}`);
            } else {
                console.log(`Column ${name} already exists.`);
            }
        }

        // 2. Add indexes for performance
        console.log('Adding indexes...');
        await query(`CREATE INDEX IF NOT EXISTS idx_analytics_entity ON analytics_events(tenant_id, entity_type, entity_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(tenant_id, event_type)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(tenant_id, created_at)`);

        console.log('✅ Migration completed successfully!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    }
}

migrate();
