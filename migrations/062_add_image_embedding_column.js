/**
 * Migration 062: Add image_embedding column for CLIP
 * 
 * Adds a second vector column to support parallel image-based search.
 * Model: Xenova/clip-vit-base-patch32 (512 dimensions)
 */

const { query } = require('../config/database');

async function up() {
    console.log('[Migration 062] Adding image_embedding column (512D)...');

    // 1. Add image_embedding column
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_embedding vector(512)`);

    // 2. Add HNSW index for the image vector space
    await query(`
        CREATE INDEX IF NOT EXISTS idx_products_image_embedding_hnsw 
        ON products 
        USING hnsw (image_embedding vector_cosine_ops)
    `);

    // 3. Add a timestamp for image embedding updates
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_embedding_updated_at TIMESTAMP WITH TIME ZONE`);

    console.log('[Migration 062] image_embedding column + HNSW index created.');
}

async function down() {
    await query(`DROP INDEX IF EXISTS idx_products_image_embedding_hnsw`);
    await query(`ALTER TABLE products DROP COLUMN IF EXISTS image_embedding_updated_at`);
    await query(`ALTER TABLE products DROP COLUMN IF EXISTS image_embedding`);
}

module.exports = { up, down };
