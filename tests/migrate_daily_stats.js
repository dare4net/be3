const { query } = require('../config/database');

async function migrate() {
    console.log('🚀 Starting daily_stats schema migration...');
    try {
        const columns = [
            ['total_sales', 'DECIMAL(10, 2) DEFAULT 0'],
            ['order_count', 'INTEGER DEFAULT 0'],
            ['new_customers', 'INTEGER DEFAULT 0']
        ];

        for (const [name, type] of columns) {
            console.log(`Checking column: ${name}...`);
            const check = await query(`
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'daily_stats' AND column_name = $1
            `, [name]);

            if (check.rows.length === 0) {
                console.log(`Adding column: ${name} (${type})`);
                await query(`ALTER TABLE daily_stats ADD COLUMN ${name} ${type}`);
            } else {
                console.log(`Column ${name} already exists.`);
            }
        }

        console.log('✅ Migration completed successfully!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    }
}

migrate();
