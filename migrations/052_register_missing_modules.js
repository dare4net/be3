/**
 * Migration 052: Register missing feature modules in the module registry
 * 
 * This migration populates the `modules` table with all the available feature modules
 * so they can be managed via the Super Admin and subscribed to by tenants.
 */

const { query } = require('../config/database');

async function up() {
    console.log('[Migration 052] Registering missing feature modules...');

    const modules = [
        { name: 'page_builder', display_name: 'Page Builder', description: 'Drag-and-drop page builder for the storefront.' },
        { name: 'shipping', display_name: 'Shipping', description: 'Manage shipping methods and zones.' },
        { name: 'marketing', display_name: 'Marketing', description: 'Coupons, promotions, and email marketing.' },
        { name: 'analytics', display_name: 'Analytics', description: 'Track store performance and customer behavior.' },
        { name: 'search', display_name: 'Advanced Search', description: 'Powerful search with filters and facets.' },
        { name: 'menus', display_name: 'Menus & Navigation', description: 'Manage site-wide navigation menus.' },
        { name: 'banner', display_name: 'Banners', description: 'Promotional banners and sliders.' },
        { name: 'variables', display_name: 'Variables', description: 'Custom system-wide variables and settings.' },
        { name: 'vendor', display_name: 'Multi-Vendor', description: 'Allow third-party vendors to sell on your platform.' },
        { name: 'chat', display_name: 'Chat & Support', description: 'Real-time chat and customer support.' },
        { name: 'location', display_name: 'Locations', description: 'Manage physical store locations and pickups.' },
        { name: 'wishlist', display_name: 'Wishlist', description: 'Allow customers to save products for later.' },
        { name: 'vector', display_name: 'Semantic Search', description: 'AI-powered vector search for products.' },
    ];

    for (const mod of modules) {
        await query(`
            INSERT INTO modules (name, display_name, version, is_core, description)
            VALUES ($1, $2, $3, false, $4)
            ON CONFLICT (name) 
            DO UPDATE SET 
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                updated_at = NOW()
        `, [mod.name, mod.display_name, '1.0.0', mod.description]);
    }

    console.log('[Migration 052] Done. Registered ' + modules.length + ' modules.');
}

async function down() {
    // We don't necessarily want to remove modules on down as it might break tenant_modules
    console.log('[Migration 052] Down migration skipped (safe-guard).');
}

module.exports = { up, down };
