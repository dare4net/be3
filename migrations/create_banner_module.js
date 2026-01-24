const { query } = require('../config/database');

async function run() {
    console.log('Migrating Banner Module...');

    // 1. Register Module
    try {
        await query(`
            INSERT INTO modules (name, display_name, description, version, is_core)
            VALUES ('banner', 'Banners', 'Manage storefront banner groups and images', '1.0.0', false)
            ON CONFLICT (name) DO UPDATE SET 
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description;
        `);
        console.log('Module registered.');
    } catch (e) {
        console.error('Module registration failed:', e);
    }

    // 2. Create Banner Groups Table
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS banner_groups (
                id UUID PRIMARY KEY,
                tenant_id UUID NOT NULL,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        // Index for tenant lookups
        await query(`CREATE INDEX IF NOT EXISTS idx_banner_groups_tenant ON banner_groups(tenant_id);`);
        console.log('Table banner_groups created.');
    } catch (e) {
        console.error('Table banner_groups creation failed:', e);
    }

    // 3. Create Banners Table
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS banners (
                id UUID PRIMARY KEY,
                group_id UUID REFERENCES banner_groups(id) ON DELETE CASCADE,
                type VARCHAR(50) DEFAULT 'image', -- image, category, collection
                url TEXT,
                image_url TEXT,
                title VARCHAR(255),
                subtitle VARCHAR(255),
                resource_id VARCHAR(255), -- ID of linked resource
                sort_order INT DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        // Index for group lookups
        await query(`CREATE INDEX IF NOT EXISTS idx_banners_group ON banners(group_id);`);
        console.log('Table banners created.');
    } catch (e) {
        console.error('Table banners creation failed:', e);
    }

    console.log('Migration complete.');
    process.exit(0);
}

run();
