const { query } = require('../config/database');

async function fixRegistration() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    
    try {
        console.log(`Fixing system page registration for tenant: ${tenantId}`);

        const systemPages = [
            { slug: 'collection_detail', title: 'Collection Page' },
            { slug: 'category_detail', title: 'Category Details Page' },
            { slug: 'branded_search', title: 'Branded Search Page' }
        ];

        for (const p of systemPages) {
            // Check if exists
            const exist = await query('SELECT id FROM pages WHERE tenant_id = $1 AND slug = $2', [tenantId, p.slug]);
            
            if (exist.rows.length === 0) {
                await query(
                    `INSERT INTO pages (tenant_id, slug, title, is_system, is_published, show_in_nav) 
                     VALUES ($1, $2, $3, true, true, false)`,
                    [tenantId, p.slug, p.title]
                );
                console.log(`✓ Registered ${p.title} (${p.slug})`);
            } else {
                await query(
                    `UPDATE pages SET title = $3, is_system = true WHERE tenant_id = $1 AND slug = $2`,
                    [tenantId, p.slug, p.title]
                );
                console.log(`✓ Updated ${p.title} (${p.slug})`);
            }
        }

        console.log('\n✓ System pages registered successfully.');
        process.exit(0);
    } catch (error) {
        console.error('✗ Registration failed:', error);
        process.exit(1);
    }
}

fixRegistration();
