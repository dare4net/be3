/**
 * Storefront Helper
 * 
 * Provides safe selection fields for public storefront APIs to optimize 
 * payload size and prevent leaking sensitive internal data (like cost).
 */

const PRODUCT_SAFE_COLUMNS = `
    id, tenant_id, name, description, sku, price, compare_at_price, 
    track_inventory, inventory_quantity, status, published_at, 
    created_at, updated_at, handle, is_featured, tags, 
    seo_title, seo_description, category_id, meta_description, 
    og_title, og_description, og_image, og_type, twitter_card, 
    twitter_title, twitter_description, twitter_image, canonical_url, 
    robots, structured_data, image_url, created_by, parent_id, 
    is_variant, variant_label, whats_included, attributes
`.trim();

const SEARCH_INDEX_SAFE_COLUMNS = `
    id, tenant_id, content_type, content_id, title, keywords, 
    metadata, is_active, created_at, updated_at
`.trim();

module.exports = {
    PRODUCT_SAFE_COLUMNS,
    SEARCH_INDEX_SAFE_COLUMNS
};
