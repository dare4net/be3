const { query } = require('../config/database');

async function seedPages() {
    try {
        console.log('Seeding default pages for all tenants...');

        // Get all tenants
        const tenantsRes = await query('SELECT id, name FROM tenants');
        const tenants = tenantsRes.rows;

        console.log(`Found ${tenants.length} tenant(s)`);

        for (const tenant of tenants) {
            console.log(`\nSeeding pages for tenant: ${tenant.name} (${tenant.id})`);

            // Check if pages already exist
            const existing = await query(
                'SELECT * FROM pages WHERE tenant_id = $1',
                [tenant.id]
            );

            if (existing.rows.length > 0) {
                console.log(`  ⚠ Pages already exist for ${tenant.name}, skipping...`);
                continue;
            }

            // Create default pages
            const defaultPages = [
                {
                    slug: 'home',
                    title: 'Home',
                    meta_description: `Welcome to ${tenant.name}`,
                    is_published: true,
                    show_in_nav: false, // Home typically not shown in nav
                    is_system: true
                },
                {
                    slug: 'about',
                    title: 'About Us',
                    meta_description: `Learn more about ${tenant.name}`,
                    is_published: true,
                    show_in_nav: true,
                    is_system: false
                },
                {
                    slug: 'contact',
                    title: 'Contact',
                    meta_description: `Get in touch with ${tenant.name}`,
                    is_published: true,
                    show_in_nav: true,
                    is_system: false
                }
            ];

            for (const page of defaultPages) {
                await query(
                    `INSERT INTO pages (tenant_id, slug, title, meta_description, is_published, show_in_nav, is_system)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [tenant.id, page.slug, page.title, page.meta_description, page.is_published, page.show_in_nav, page.is_system]
                );
                console.log(`  ✓ Created page: ${page.title} (/${page.slug})`);
            }
        }

        console.log('\n✓ Default pages seeded successfully');
        process.exit(0);
    } catch (error) {
        console.error('✗ Seeding failed:', error);
        process.exit(1);
    }
}

seedPages();
