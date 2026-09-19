/**
 * migrate_search_widgets.js
 * 
 * One-time migration: converts search-related unknown_widget rows to
 * properly registered search_page_layout widgets.
 * 
 * Run once per environment:
 *   node scripts/migrate_search_widgets.js
 */

const { query } = require('../config/database');

// Base config shared by all search page layout instances.
// Values are identical to the previous hardcoded defaults in LegacyWidgetBridge.
const BASE = {
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

// Per legacy_type config overrides — preserves exact previous hardcoded behaviour.
const CONFIGS = {
    // Branded search + standard search page: full search UI (was <SearchPageLayout /> with no config)
    search_layout: { ...BASE, showSearchBar: true, showImageSearchBar: true },

    // Collection page: search bar was explicitly disabled (was config={{ showSearchBar: false, fullWidth: true }})
    collection_search: { ...BASE, showSearchBar: false, showImageSearchBar: true },

    // Category page: all defaults (was <SearchPageLayout /> with no config)
    category_search: { ...BASE, showSearchBar: true, showImageSearchBar: true },
};

async function migrate() {
    console.log('Starting search widget migration...\n');

    let totalUpdated = 0;

    for (const [legacyType, config] of Object.entries(CONFIGS)) {
        const res = await query(
            `UPDATE page_widgets
             SET widget_type = 'search_page_layout',
                 config      = $1::jsonb
             WHERE widget_type = 'unknown_widget'
               AND config->>'legacy_type' = $2
             RETURNING id, tenant_id, page_type`,
            [JSON.stringify(config), legacyType]
        );

        const count = res.rows.length;
        totalUpdated += count;

        if (count > 0) {
            console.log(`✓ [${legacyType}] → search_page_layout  (${count} row${count !== 1 ? 's' : ''})`);
            res.rows.forEach(r =>
                console.log(`    tenant=${r.tenant_id}  page_type=${r.page_type}  id=${r.id}`)
            );
        } else {
            console.log(`  [${legacyType}] — no rows matched (already migrated or absent)`);
        }
    }

    console.log(`\n✓ Migration complete — ${totalUpdated} total row(s) updated.`);
}

migrate()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('✗ Migration failed:', err);
        process.exit(1);
    });
