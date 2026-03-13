/**
 * Migration 051: Enable pgvector and add product embedding column
 * 
 * Adds vector search capabilities to the products table using pgvector.
 * Model: Xenova/all-MiniLM-L6-v2 (384 dimensions)
 * 
 * Prerequisites: pgvector extension must be available on your PostgreSQL instance.
 * Most managed providers (Supabase, Neon, AWS RDS) support it out of the box.
 * For local dev: run `CREATE EXTENSION vector;` manually or install pgvector.
 */

const { query } = require('../config/database');

async function up() {
    console.log('[Migration 051] Enabling pgvector extension...');

    // 1. Enable the extension
    await query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // 2. Add embedding column (384 dimensions for all-MiniLM-L6-v2)
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(384)`);

    // 3. Add HNSW index for fast cosine similarity search
    //    HNSW is preferred over IVFFlat because it doesn't require training
    //    and provides better recall at the cost of slightly more memory.
    await query(`
        CREATE INDEX IF NOT EXISTS idx_products_embedding_hnsw 
        ON products 
        USING hnsw (embedding vector_cosine_ops)
    `);

    // 4. Add a timestamp to track when embeddings were last generated
    await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMP WITH TIME ZONE`);

    console.log('[Migration 051] pgvector enabled, embedding column + HNSW index created.');
}

async function down() {
    await query(`DROP INDEX IF EXISTS idx_products_embedding_hnsw`);
    await query(`ALTER TABLE products DROP COLUMN IF EXISTS embedding_updated_at`);
    await query(`ALTER TABLE products DROP COLUMN IF EXISTS embedding`);
    // Note: We don't drop the extension because other tables might use it.
}

module.exports = { up, down };
