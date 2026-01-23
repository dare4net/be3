const { query } = require('./config/database');

async function applyIndexes() {
    const indexes = [
        {
            name: 'idx_categories_parent_id',
            sql: 'CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)'
        },
        {
            name: 'idx_categories_tenant_name',
            sql: 'CREATE INDEX IF NOT EXISTS idx_categories_tenant_name ON categories(tenant_id, name)'
        },
        {
            name: 'idx_category_attributes_composite',
            sql: 'CREATE INDEX IF NOT EXISTS idx_category_attributes_composite ON category_attributes(category_id, attribute_id)'
        },
        {
            name: 'idx_attributes_tenant_code',
            sql: 'CREATE INDEX IF NOT EXISTS idx_attributes_tenant_code ON attributes(tenant_id, code)'
        }
    ];

    console.log('--- Applying Database Indexes ---');

    for (const index of indexes) {
        try {
            console.log(`Applying ${index.name}...`);
            await query(index.sql);
            console.log(`✅ ${index.name} applied successfully.`);
        } catch (err) {
            console.error(`❌ Failed to apply ${index.name}:`, err.message);
        }
    }

    console.log('--- Done ---');
    process.exit();
}

applyIndexes();
