const { query } = require('../../../config/database');
const Layout = require('../models/Layout');

class ProvisioningService {
    /**
     * Initializes default content for a new or existing tenant.
     * This includes system pages, templates, and default widgets.
     */
    static async provisionDefaults(tenantId) {
        console.log(`[PageBuilder] Provisioning defaults for tenant: ${tenantId}`);

        try {
            // 1. Provision System Pages & Templates
            await this.provisionPages(tenantId);

            // 2. Provision Default Widgets
            await this.provisionWidgets(tenantId);

            return { success: true };
        } catch (error) {
            console.error(`[PageBuilder] Provisioning failed for tenant ${tenantId}:`, error);
            throw error;
        }
    }

    /**
     * Ensures all required system pages and storefront templates exist.
     */
    static async provisionPages(tenantId) {
        const pages = [
            // Standard Pages
            { slug: 'home', title: 'Home', is_system: true, is_published: true, show_in_nav: false },
            { slug: 'about', title: 'About Us', is_system: false, is_published: true, show_in_nav: true },
            { slug: 'contact', title: 'Contact', is_system: false, is_published: true, show_in_nav: true },

            // Storefront Templates
            { slug: 'collection_detail', title: 'Collection Page', is_system: true, is_published: true, show_in_nav: false },
            { slug: 'category_detail', title: 'Category Details Page', is_system: true, is_published: true, show_in_nav: false },
            { slug: 'branded_search', title: 'Branded Search Page', is_system: true, is_published: true, show_in_nav: false }
        ];

        for (const p of pages) {
            await query(`
                INSERT INTO pages (tenant_id, slug, title, is_system, is_published, show_in_nav)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (tenant_id, slug) DO UPDATE SET
                    is_system = EXCLUDED.is_system,
                    is_published = EXCLUDED.is_published;
            `, [tenantId, p.slug, p.title, p.is_system, p.is_published, p.show_in_nav]);
        }
    }

    /**
     * Injects default "Legacy" widgets for storefront templates if they don't have widgets yet.
     */
    static async provisionWidgets(tenantId) {
        // We need an active layout to attach widgets to
        let layout = await Layout.findActive(tenantId);
        if (!layout) {
            layout = await Layout.findDefault(tenantId);
        }

        // If still no layout, we can't provision widgets (unlikely in a healthy tenant)
        if (!layout) {
            console.warn(`[PageBuilder] No active/default layout found for tenant ${tenantId}. Skipping widget provisioning.`);
            return;
        }

        const defaultWidgets = [
            // Collection Details
            { page_type: 'collection_detail', widget_type: 'unknown_widget', config: { legacy_type: 'collection_hero' }, sort_order: 0 },
            { page_type: 'collection_detail', widget_type: 'unknown_widget', config: { legacy_type: 'collection_search' }, sort_order: 10 },

            // Category Details
            { page_type: 'category_detail', widget_type: 'unknown_widget', config: { legacy_type: 'category_hero' }, sort_order: 0 },
            { page_type: 'category_detail', widget_type: 'unknown_widget', config: { legacy_type: 'category_subnav' }, sort_order: 10 },
            { page_type: 'category_detail', widget_type: 'unknown_widget', config: { legacy_type: 'category_search' }, sort_order: 20 },
            { page_type: 'category_detail', widget_type: 'unknown_widget', config: { legacy_type: 'category_suggestions' }, sort_order: 30 },

            // Branded Search
            { page_type: 'branded_search', widget_type: 'unknown_widget', config: { legacy_type: 'search_layout' }, sort_order: 0 }
        ];

        for (const w of defaultWidgets) {
            // Only insert if this page_type for this layout has NO widgets of this legacy_type
            // This prevents duplicating the "Search Layout" every time the migration or event runs
            const exists = await query(`
                SELECT id FROM page_widgets 
                WHERE tenant_id = $1 AND layout_id = $2 AND page_type = $3 
                AND config->>'legacy_type' = $4
            `, [tenantId, layout.id, w.page_type, w.config.legacy_type]);

            if (exists.rows.length === 0) {
                await query(`
                    INSERT INTO page_widgets (tenant_id, layout_id, page_type, widget_type, config, sort_order, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6, true)
                `, [tenantId, layout.id, w.page_type, w.widget_type, JSON.stringify(w.config), w.sort_order]);
            }
        }
    }
}

module.exports = ProvisioningService;
