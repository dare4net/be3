/**
 * One-time seed: marks all already-run migrations in the new schema_migrations table.
 * Safe to run multiple times (ON CONFLICT DO NOTHING).
 */
const { pool } = require('../config/database');

const ALREADY_RAN = [
    'migrations/022_create_layouts_system.sql',
    'migrations/027_search_module.sql',
    'migrations/028_tenant_rate_limit_exempt.sql',
    'migrations/029_user_category_permissions.sql',
    'migrations/051_enable_pgvector.js',
    'migrations/052_register_missing_modules.js',
    'migrations/053_add_session_id_to_orders.js',
    'migrations/060_add_range_and_custom_attributes.sql',
    'migrations/061_add_product_variants_support.sql',
    'migrations/062_add_image_embedding_column.js',
    'migrations/063_add_theme_overrides_to_pages.sql',
    'migrations/064_normalize_theme_variables.js',
    'migrations/065_register_storefront_templates.js',
    'migrations/066_vendor_category_ledger.js',
    'migrations/067_enhance_vendor_category_ledger_with_id.js',
    'migrations/068_add_business_description_to_users.js',
    'migrations/069_add_whats_included_to_products.sql',
    'migrations/070_create_reviews_module.sql',
    'migrations/071_add_oauth_to_users.js',
    'migrations/072_add_user_profile_fields.js',
    'migrations/073_add_email_verification_expiry.js',
    'migrations/074_paystack_payments.js',
    'migrations/075_expand_orders_status_constraint.js',
    'migrations/076_tiered_verification.js',
    'migrations/077_vendor_applications.js',
    'migrations/078_vendor_test_products.js',
    'migrations/079_vendor_permissions.js',
    'migrations/080_kyc_poi_poa_liveness.js',
    'migrations/081_standardize_order_payment_status.js',
];

async function seed() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id        SERIAL PRIMARY KEY,
            migration TEXT NOT NULL UNIQUE,
            ran_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    for (const m of ALREADY_RAN) {
        await pool.query(
            'INSERT INTO schema_migrations (migration) VALUES ($1) ON CONFLICT DO NOTHING',
            [m]
        );
        console.log('✓ Seeded:', m);
    }

    console.log('\nDone — all previous migrations recorded. Future runs will skip these.');
    await pool.end();
}

seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
});
