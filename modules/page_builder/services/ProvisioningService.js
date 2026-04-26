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
     * Injects default widgets for storefront templates if they don't have widgets yet.
     * Legacy widgets (hero, subnav, suggestions) remain as unknown_widget + legacy_type.
     * Search widgets are registered as first-class search_page_layout widgets.
     */
    static async provisionWidgets(tenantId) {
        let layout = await Layout.findActive(tenantId);
        if (!layout) layout = await Layout.findDefault(tenantId);

        if (!layout) {
            console.warn(`[PageBuilder] No active/default layout found for tenant ${tenantId}. Skipping widget provisioning.`);
            return;
        }

        // Base config shared by all search_page_layout instances
        const searchBase = {
            columns: { desktop: 5, tablet: 3, mobile: 2 },
            sidebarEnabled: true,
            showFilters: true,
            showActiveFiltersBar: true,
            showPrice: true,
            showAddToCart: true,
            showFeaturedBadge: true,
            showViewDetails: true,
            showTags: false,
            showDescription: true,
            showAttributes: false,
            showSocialProof: true,
            showRating: false,
            cardScale: 0.9,
        };

        const defaultWidgets = [
            // ── Collection Details ──────────────────────────────────────────
            // Hero stays as legacy bridge
            { page_type: 'collection_detail', widget_type: 'unknown_widget',      config: { legacy_type: 'collection_hero' },   sort_order: 0,  dedupeBy: 'legacy_type' },
            // Search results — properly registered, search bar hidden (collection header provides context)
            { page_type: 'collection_detail', widget_type: 'search_page_layout',  config: { ...searchBase, showSearchBar: false, showImageSearchBar: true }, sort_order: 10, dedupeBy: 'widget_type' },

            // ── Category Details ────────────────────────────────────────────
            { page_type: 'category_detail',  widget_type: 'unknown_widget',       config: { legacy_type: 'category_hero' },     sort_order: 0,  dedupeBy: 'legacy_type' },
            { page_type: 'category_detail',  widget_type: 'unknown_widget',       config: { legacy_type: 'category_subnav' },   sort_order: 10, dedupeBy: 'legacy_type' },
            // Search results — properly registered, full UI
            { page_type: 'category_detail',  widget_type: 'search_page_layout',   config: { ...searchBase, showSearchBar: true,  showImageSearchBar: true }, sort_order: 20, dedupeBy: 'widget_type' },
            { page_type: 'category_detail',  widget_type: 'unknown_widget',       config: { legacy_type: 'category_suggestions' }, sort_order: 30, dedupeBy: 'legacy_type' },

            // ── Branded Search ──────────────────────────────────────────────
            { page_type: 'branded_search',   widget_type: 'search_page_layout',   config: { ...searchBase, showSearchBar: true,  showImageSearchBar: true }, sort_order: 0,  dedupeBy: 'widget_type' },
        ];

        for (const w of defaultWidgets) {
            let exists;

            if (w.dedupeBy === 'legacy_type') {
                // Legacy widgets — check by legacy_type in config
                exists = await query(`
                    SELECT id FROM page_widgets
                    WHERE tenant_id = $1 AND layout_id = $2 AND page_type = $3
                      AND config->>'legacy_type' = $4
                `, [tenantId, layout.id, w.page_type, w.config.legacy_type]);
            } else {
                // Proper widgets — check by widget_type for this page_type
                exists = await query(`
                    SELECT id FROM page_widgets
                    WHERE tenant_id = $1 AND layout_id = $2 AND page_type = $3
                      AND widget_type = $4
                `, [tenantId, layout.id, w.page_type, w.widget_type]);
            }

            if (exists.rows.length === 0) {
                const { dedupeBy, ...widgetData } = w;
                await query(`
                    INSERT INTO page_widgets (tenant_id, layout_id, page_type, widget_type, config, sort_order, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6, true)
                `, [tenantId, layout.id, widgetData.page_type, widgetData.widget_type, JSON.stringify(widgetData.config), widgetData.sort_order]);
            }
        }
    }

}

module.exports = ProvisioningService;
