/**
 * Vector Engine
 * 
 * Core engine for vector/semantic search operations using pgvector.
 * Communicates with the be3-ai-transformer for embedding generation.
 * 
 * Capabilities:
 *   - Generate embeddings for products (single + bulk)
 *   - Semantic similarity search
 *   - Find similar products
 *   - Embedding CRUD (insert, update, upsert, delete)
 *   - Stats and diagnostics
 */

const axios = require('axios');
const { query, pool } = require('../../../config/database');

const TRANSFORMER_URL = process.env.TRANSFORMER_URL || 'http://localhost:3009';

let isInitialized = false;

class VectorEngine {
    constructor() {
        this.modelKey = (process.env.EMBEDDING_MODEL_KEY || '').toLowerCase().trim();
        this.modelName = process.env.EMBEDDING_MODEL_NAME || 'all-MiniLM-L6-v2';
        this.dimensions = process.env.EMBEDDING_DIMENSIONS ? parseInt(process.env.EMBEDDING_DIMENSIONS) : 384;
        this.isBge = this.modelKey === 'bge-small' || this.modelName.toLowerCase().includes('bge');

        if (!isInitialized) {
            console.log(`[VectorEngine] Initialized: ${this.modelName} (BGE=${this.isBge}, ${this.dimensions}D)`);
            isInitialized = true;
        }
    }

    // ═══════════════════════════════════════════════════════
    //  EMBEDDING GENERATION
    // ═══════════════════════════════════════════════════════

    /**
     * Get an embedding vector from the transformer service.
     * @param {string} text - The text to embed
     * @returns {Promise<number[]>} - The embedding vector (384 dims)
     */
    async getEmbedding(text, options = {}) {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('Cannot embed empty text');
        }

        try {
            const purpose = options.purpose || (this.isBge ? 'query' : undefined);
            const body = { text: text.trim() };
            if (purpose) body.purpose = purpose;

            console.log(`[VectorEngine] POST /embed | Text: "${text.substring(0, 50)}..." | Length: ${text.length} | Purpose: ${purpose}`);

            const res = await axios.post(`${TRANSFORMER_URL}/embed`, body);
            const embeddings = res.data?.embeddings;
            if (!embeddings || !Array.isArray(embeddings) || embeddings.length === 0) {
                throw new Error('Transformer returned empty embeddings');
            }
            // The transformer returns [[...384 floats]], we want the first entry
            return embeddings[0];
        } catch (err) {
            if (err.code === 'ECONNREFUSED') {
                throw new Error(`Transformer service is not running at ${TRANSFORMER_URL}. Start it with: cd be3-ai-transformer && npm start`);
            }
            throw new Error(`Embedding generation failed: ${err.message}`);
        }
    }

    /**
     * Get embeddings for multiple texts in one call.
     * @param {string[]} texts - Array of texts
     * @returns {Promise<number[][]>} - Array of embedding vectors
     */
    async getEmbeddings(texts, options = {}) {
        if (!Array.isArray(texts) || texts.length === 0) return [];

        try {
            const purpose = options.purpose || (this.isBge ? 'passage' : undefined);
            const body = { texts };
            if (purpose) body.purpose = purpose;

            console.log(`[VectorEngine] POST /embed (Batch) | Count: ${texts.length} | Purpose: ${purpose}`);

            const res = await axios.post(`${TRANSFORMER_URL}/embed`, body);
            const embeddings = res.data?.embeddings;
            if (!embeddings || !Array.isArray(embeddings) || embeddings.length === 0) {
                throw new Error('Transformer returned empty embeddings');
            }
            return embeddings;
        } catch (err) {
            console.error(`[VectorEngine] Batch embedding failed:`, err.message);
            // Fallback to sequential if batch fails for some reason
            const results = [];
            for (const text of texts) {
                try {
                    const embedding = await this.getEmbedding(text, { purpose: options.purpose });
                    results.push(embedding);
                } catch (e) {
                    results.push(null);
                }
            }
            return results;
        }
    }

    // ═══════════════════════════════════════════════════════
    //  PRODUCT EMBEDDING (single + bulk)
    // ═══════════════════════════════════════════════════════

    /**
     * Build a rich text representation of a product for embedding.
     * Optimized for higher signal density:
     * 1. Anchoring: Name is repeated twice to give it more weight.
     * 2. Context: Includes human-readable category name.
     * 3. Denoising: Shorter description (100 chars) to prevent dilution.
     * 
     * @param {Object} product - The product row (including category_name)
     * @param {Object} attributeLabels - Mapping of attribute codes to human labels
     * @returns {string}
     */
    buildProductText(product, attributeLabels = {}) {
        const parts = [];

        // 1. Anchoring: Boost the name to repeat 3 times at the start
        if (product.name) {
            parts.push(`${product.name} | ${product.name} | ${product.name}`);
        }

        // 2. Contextualize with category
        if (product.category_name) {
            parts.push(`Category: ${product.category_name}`);
        }

        // 3. Attributes: Higher signal than description, so we process them before the storytelling text
        if (product.attributes) {
            const attrs = typeof product.attributes === 'string' ? JSON.parse(product.attributes) : product.attributes;
            const attrParts = Object.entries(attrs)
                .filter(([_, v]) => v !== null && v !== undefined && v !== '')
                .map(([k, v]) => {
                    const label = attributeLabels[k] || k;
                    if (typeof v === 'object' && v !== null && (v.min !== undefined || v.max !== undefined)) {
                        return `${label} is ${v.min || 'minimum'} to ${v.max || 'maximum'}`;
                    }
                    return `${label} is ${v}`;
                });
            if (attrParts.length > 0) parts.push(attrParts.join(', '));
        }

        // 4. Description: Moved to the END to avoid diluting the high-signal names/attrs
        // Capacity is dynamic based on model (BGE = 1000, MiniLM = 100)
        if (product.description) {
            const descLimit = this.isBge ? 1000 : 100;
            const plain = product.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            parts.push(`Description: ${plain.substring(0, descLimit)}`);
        }

        if (Array.isArray(product.tags) && product.tags.length > 0) {
            parts.push(product.tags.join(' '));
        }

        return parts.join(' | ');
    }

    /**
     * Generate and store an embedding for a single product.
     * @param {string} tenantId
     * @param {string} productId
     * @returns {Promise<{productId, embedded, text}>}
     */
    async embedProduct(tenantId, productId) {
        const result = await query(
            `SELECT p.id, p.name, p.description, p.tags, p.attributes, 
                    (SELECT STRING_AGG(c.name, ', ') 
                     FROM categories c 
                     JOIN product_categories pc ON c.id = pc.category_id 
                     WHERE pc.product_id = p.id) as category_name
             FROM products p
             WHERE p.id = $1 AND p.tenant_id = $2`,
            [productId, tenantId],
            tenantId
        );

        if (result.rows.length === 0) {
            throw new Error(`Product ${productId} not found for tenant ${tenantId}`);
        }

        const product = result.rows[0];
        const labels = await this.getAttributeLabels(tenantId);
        const text = this.buildProductText(product, labels);
        const embedding = await this.getEmbedding(text, { purpose: this.isBge ? 'passage' : undefined });

        await this.upsertEmbedding(tenantId, productId, embedding);

        return { productId, embedded: true, text };
    }

    /**
     * Generate and store embeddings for ALL products of a tenant.
     * Refactored for BATCH processing to ensure performance at scale.
     * 
     * @param {string} tenantId
     * @param {Object} options
     * @param {boolean} options.force - If true, re-embed even if embedding exists
     * @param {number} options.batchSize - Number of products per batch (default 50)
     * @returns {Promise<{total, embedded, skipped, failed, duration}>}
     */
    async embedAllProducts(tenantId, options = {}) {
        const { force = false, batchSize = 50 } = options;
        const startTime = Date.now();

        let sql = `
            SELECT p.id, p.name, p.description, p.tags, p.attributes, 
                   (SELECT STRING_AGG(c.name, ', ') 
                    FROM categories c 
                    JOIN product_categories pc ON c.id = pc.category_id 
                    WHERE pc.product_id = p.id) as category_name
            FROM products p
            WHERE p.tenant_id = $1 AND p.status = 'active'
        `;
        if (!force) {
            sql += ` AND (p.embedding IS NULL OR p.embedding_updated_at IS NULL)`;
        }
        sql += ` ORDER BY p.created_at DESC`;

        const result = await query(sql, [tenantId], tenantId);
        const products = result.rows;

        if (products.length === 0) {
            return { total: 0, embedded: 0, skipped: 0, failed: 0, duration: '0ms' };
        }

        // Fetch attribute mapping once for the whole tenant
        const labels = await this.getAttributeLabels(tenantId);

        let embedded = 0;
        let skipped = 0;
        let failed = 0;

        // Process in batches
        for (let i = 0; i < products.length; i += batchSize) {
            const batch = products.slice(i, i + batchSize);
            const batchTexts = [];
            const validBatch = [];

            // 1. Prepare texts for the batch
            for (const product of batch) {
                const text = this.buildProductText(product, labels);
                if (!text || text.trim().length < 3) {
                    skipped++;
                    continue;
                }
                batchTexts.push(text);
                validBatch.push(product);
            }

            if (batchTexts.length === 0) continue;

            try {
                // 2. Get embeddings in one call
                const embeddings = await this.getEmbeddings(batchTexts, { purpose: this.isBge ? 'passage' : undefined });

                // 3. Persist batch results
                // We use Promise.all for database updates within the batch for speed
                await Promise.all(validBatch.map((product, idx) => {
                    if (embeddings[idx]) {
                        embedded++;
                        return this.upsertEmbedding(tenantId, product.id, embeddings[idx]);
                    } else {
                        failed++;
                        return Promise.resolve();
                    }
                }));

                console.log(`[VectorEngine] Progress: ${Math.min(i + batchSize, products.length)}/${products.length} products processed...`);
            } catch (err) {
                console.error(`[VectorEngine] Batch processing failed at offset ${i}:`, err.message);
                failed += validBatch.length;
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[VectorEngine] Bulk embed complete: ${embedded} embedded, ${skipped} skipped, ${failed} failed (${duration}ms)`);

        return { total: products.length, embedded, skipped, failed, duration: `${duration}ms` };
    }

    /**
     * Fetch all attribute labels for a tenant to map codes to names.
     * @param {string} tenantId
     * @returns {Promise<Object>} - Mapping of {code: label}
     */
    async getAttributeLabels(tenantId) {
        try {
            const result = await query(
                `SELECT code, label FROM attributes WHERE tenant_id = $1`,
                [tenantId],
                tenantId
            );

            const mapping = {};
            result.rows.forEach(row => {
                mapping[row.code] = row.label;
            });
            return mapping;
        } catch (err) {
            console.error('[VectorEngine] Failed to fetch attribute labels:', err.message);
            return {}; // Fallback to empty mapping
        }
    }

    // ═══════════════════════════════════════════════════════
    //  VECTOR DATABASE OPERATIONS (CRUD)
    // ═══════════════════════════════════════════════════════

    /**
     * Insert or update an embedding for a product.
     * @param {string} tenantId
     * @param {string} productId
     * @param {number[]} embedding - The vector (384 floats)
     */
    async upsertEmbedding(tenantId, productId, embedding) {
        const vectorStr = `[${embedding.join(',')}]`;
        await query(
            `UPDATE products SET embedding = $1::vector, embedding_updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            [vectorStr, productId, tenantId],
            tenantId
        );
    }

    /**
     * Get the raw embedding vector for a product.
     * @param {string} tenantId
     * @param {string} productId
     * @returns {Promise<number[]|null>}
     */
    async getProductEmbedding(tenantId, productId) {
        const result = await query(
            `SELECT embedding::text FROM products WHERE id = $1 AND tenant_id = $2 AND embedding IS NOT NULL`,
            [productId, tenantId],
            tenantId
        );
        if (result.rows.length === 0) return null;

        // pgvector returns "[0.1,0.2,...]" as text — parse it
        return JSON.parse(result.rows[0].embedding);
    }

    /**
     * Check if a product has an embedding.
     * @param {string} tenantId
     * @param {string} productId
     * @returns {Promise<boolean>}
     */
    async hasEmbedding(tenantId, productId) {
        const result = await query(
            `SELECT 1 FROM products WHERE id = $1 AND tenant_id = $2 AND embedding IS NOT NULL`,
            [productId, tenantId],
            tenantId
        );
        return result.rows.length > 0;
    }

    /**
     * Clear the embedding for a single product.
     * @param {string} tenantId
     * @param {string} productId
     */
    async clearProductEmbedding(tenantId, productId) {
        await query(
            `UPDATE products SET embedding = NULL, embedding_updated_at = NULL WHERE id = $1 AND tenant_id = $2`,
            [productId, tenantId],
            tenantId
        );
    }

    /**
     * Clear all embeddings for a tenant.
     * @param {string} tenantId
     * @returns {Promise<{cleared: number}>}
     */
    async clearEmbeddings(tenantId) {
        const result = await query(
            `UPDATE products SET embedding = NULL, embedding_updated_at = NULL WHERE tenant_id = $1 AND embedding IS NOT NULL`,
            [tenantId],
            tenantId
        );
        return { cleared: result.rowCount };
    }

    // ═══════════════════════════════════════════════════════
    //  SEMANTIC SEARCH
    // ═══════════════════════════════════════════════════════

    /**
     * Perform a semantic similarity search.
     * Returns up to `limit` products ranked by cosine similarity.
     * 
     * @param {string} tenantId
     * @param {string} searchQuery - The user's search query text
     * @param {Object} options
     * @param {number} options.limit - Max results (default 20)
     * @param {number} options.threshold - Min similarity 0-1 (default 0.3)
     * @param {string} options.categoryId - Optional category filter
     * @returns {Promise<Array<{id, name, price, similarity, ...}>>}
     */
    async semanticSearch(tenantId, searchQuery, options = {}) {
        const { limit = 20, offset = 0, threshold = 0.3, categoryId = null } = options;

        // 1. Get the query embedding from the transformer
        const queryEmbedding = await this.getEmbedding(searchQuery);
        const vectorStr = `[${queryEmbedding.join(',')}]`;

        // 2. Build the SQL query using cosine distance (<=>)
        //    pgvector's <=> returns DISTANCE (0 = identical, 2 = opposite)
        //    We convert to similarity: 1 - (distance / 2) for a 0-1 percentage
        let sql = `
            SELECT 
                p.id,
                p.name,
                p.description,
                p.price,
                p.tags,
                p.status,
                p.image_url,
                p.handle,
                p.created_at,
                1 - (p.embedding <=> $1::vector) AS similarity
            FROM products p
            WHERE p.tenant_id = $2
              AND p.status = 'active'
              AND p.embedding IS NOT NULL
              AND 1 - (p.embedding <=> $1::vector) >= $3
        `;
        const params = [vectorStr, tenantId, threshold];
        let paramIndex = 4;

        if (categoryId) {
            sql += ` AND p.category_id = $${paramIndex}`;
            params.push(categoryId);
            paramIndex++;
        }

        // Apply external filters (from FilterSQLBuilder)
        if (options.filter && options.filter.sql) {
            sql += options.filter.sql;
            if (options.filter.params && options.filter.params.length > 0) {
                params.push(...options.filter.params);
                paramIndex += options.filter.params.length;
            }
        }

        sql += ` ORDER BY p.embedding <=> $1::vector ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await query(sql, params, tenantId);

        // 3. Format results with percentage
        return result.rows.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            price: row.price,
            tags: row.tags,
            status: row.status,
            image_url: row.image_url,
            handle: row.handle,
            similarity: parseFloat((row.similarity * 100).toFixed(2)),  // e.g. 87.42%
            similarity_raw: parseFloat(parseFloat(row.similarity).toFixed(6))
        }));
    }

    /**
     * Find products semantically similar to a given product.
     * Uses the product's own embedding as the query vector.
     * 
     * @param {string} tenantId
     * @param {string} productId - The source product
     * @param {Object} options
     * @param {number} options.limit - Max results (default 5)
     * @param {number} options.threshold - Min similarity (default 0.5)
     * @returns {Promise<Array>}
     */
    async findSimilarProducts(tenantId, productId, options = {}) {
        const { limit = 5, offset = 0, threshold = 0.5 } = options;

        let sql = `
            SELECT 
                p.id,
                p.name,
                p.price,
                p.image_url,
                1 - (p.embedding <=> source.embedding) AS similarity
            FROM products p,
                 (SELECT embedding FROM products WHERE id = $1 AND tenant_id = $2 AND embedding IS NOT NULL) source
            WHERE p.tenant_id = $2
              AND p.status = 'active'
              AND p.embedding IS NOT NULL
              AND p.id != $1
              AND 1 - (p.embedding <=> source.embedding) >= $3
        `;

        const params = [productId, tenantId, threshold];
        let paramIndex = 4;

        // Apply external filters (from FilterSQLBuilder)
        if (options.filter && options.filter.sql) {
            sql += options.filter.sql;
            if (options.filter.params && options.filter.params.length > 0) {
                params.push(...options.filter.params);
                paramIndex += options.filter.params.length;
            }
        }

        sql += ` ORDER BY p.embedding <=> source.embedding ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await query(sql, params, tenantId);

        return result.rows.map(row => ({
            id: row.id,
            name: row.name,
            price: row.price,
            image_url: row.image_url,
            similarity: parseFloat((row.similarity * 100).toFixed(2))
        }));
    }

    // ═══════════════════════════════════════════════════════
    //  ADVANCED QUERIES
    // ═══════════════════════════════════════════════════════

    /**
     * Hybrid search: combine full-text search ranking with vector similarity.
     * Uses a weighted score: (alpha * vector_similarity) + ((1-alpha) * text_rank)
     * 
     * @param {string} tenantId
     * @param {string} searchQuery
     * @param {Object} options
     * @param {number} options.limit - Default 20
     * @param {number} options.alpha - Weight for vector score (0-1, default 0.6)
     * @returns {Promise<Array>}
     */
    async hybridSearch(tenantId, searchQuery, options = {}) {
        const { limit = 20, alpha = 0.6 } = options;

        const queryEmbedding = await this.getEmbedding(searchQuery);
        const vectorStr = `[${queryEmbedding.join(',')}]`;

        const sql = `
            SELECT 
                p.id,
                p.name,
                p.price,
                p.image_url,
                1 - (p.embedding <=> $1::vector) AS vector_similarity,
                COALESCE(ts_rank(si.search_vector, plainto_tsquery('english', $3)), 0) AS text_rank,
                (
                    $4 * (1 - (p.embedding <=> $1::vector)) +
                    (1 - $4) * COALESCE(ts_rank(si.search_vector, plainto_tsquery('english', $3)), 0)
                ) AS hybrid_score
            FROM products p
            LEFT JOIN search_indexes si ON si.content_id = p.id AND si.tenant_id = $2 AND si.content_type = 'product'
            WHERE p.tenant_id = $2
              AND p.status = 'active'
              AND p.embedding IS NOT NULL
            ORDER BY hybrid_score DESC
            LIMIT $5
        `;

        const result = await query(sql, [vectorStr, tenantId, searchQuery, alpha, limit], tenantId);

        return result.rows.map(row => ({
            id: row.id,
            name: row.name,
            price: row.price,
            image_url: row.image_url,
            vector_similarity: parseFloat((row.vector_similarity * 100).toFixed(2)),
            text_rank: parseFloat(parseFloat(row.text_rank).toFixed(4)),
            hybrid_score: parseFloat(parseFloat(row.hybrid_score).toFixed(6))
        }));
    }

    /**
     * Cluster nearest neighbors: get the N closest products to a given vector.
     * Useful for recommendation engines and clustering.
     * @param {string} tenantId
     * @param {number[]} vector - A pre-computed embedding
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async nearestNeighbors(tenantId, vector, limit = 10) {
        const vectorStr = `[${vector.join(',')}]`;

        const result = await query(`
            SELECT 
                p.id, p.name, p.price, p.image_url,
                1 - (p.embedding <=> $1::vector) AS similarity
            FROM products p
            WHERE p.tenant_id = $2
              AND p.status = 'active'
              AND p.embedding IS NOT NULL
            ORDER BY p.embedding <=> $1::vector ASC
            LIMIT $3
        `, [vectorStr, tenantId, limit], tenantId);

        return result.rows.map(row => ({
            id: row.id,
            name: row.name,
            price: row.price,
            similarity: parseFloat((row.similarity * 100).toFixed(2))
        }));
    }

    /**
     * Compute cosine distance between two products.
     * @param {string} tenantId
     * @param {string} productIdA
     * @param {string} productIdB
     * @returns {Promise<{distance: number, similarity: number}>}
     */
    async computeDistance(tenantId, productIdA, productIdB) {
        const result = await query(`
            SELECT a.embedding <=> b.embedding AS distance
            FROM products a, products b
            WHERE a.id = $1 AND a.tenant_id = $3
              AND b.id = $2 AND b.tenant_id = $3
              AND a.embedding IS NOT NULL
              AND b.embedding IS NOT NULL
        `, [productIdA, productIdB, tenantId], tenantId);

        if (result.rows.length === 0) {
            throw new Error('One or both products do not have embeddings');
        }

        const distance = parseFloat(result.rows[0].distance);
        return {
            distance: parseFloat(distance.toFixed(6)),
            similarity: parseFloat(((1 - distance) * 100).toFixed(2))
        };
    }

    // ═══════════════════════════════════════════════════════
    //  STATS & DIAGNOSTICS
    // ═══════════════════════════════════════════════════════

    /**
     * Get vector statistics for a tenant.
     * @param {string} tenantId
     * @returns {Promise<{total_products, embedded_products, coverage, last_embedded_at}>}
     */
    async getStats(tenantId) {
        const result = await query(`
            SELECT 
                COUNT(*)::int AS total_products,
                COUNT(embedding)::int AS embedded_products,
                ROUND(COUNT(embedding)::numeric / GREATEST(COUNT(*)::numeric, 1) * 100, 1) AS coverage,
                MAX(embedding_updated_at) AS last_embedded_at
            FROM products
            WHERE tenant_id = $1 AND status = 'active'
        `, [tenantId], tenantId);

        const row = result.rows[0];
        return {
            total_products: row.total_products,
            embedded_products: row.embedded_products,
            coverage: `${row.coverage}%`,
            last_embedded_at: row.last_embedded_at
        };
    }

    /**
     * List products that are missing embeddings.
     * Useful for debugging and ensuring full coverage.
     * @param {string} tenantId
     * @param {number} limit
     * @returns {Promise<Array<{id, name, created_at}>>}
     */
    async getMissingEmbeddings(tenantId, limit = 50) {
        const result = await query(`
            SELECT id, name, created_at
            FROM products
            WHERE tenant_id = $1 AND status = 'active' AND embedding IS NULL
            ORDER BY created_at DESC
            LIMIT $2
        `, [tenantId, limit], tenantId);
        return result.rows;
    }

    /**
     * Verify embedding integrity: check that all stored vectors have the correct dimensions.
     * @param {string} tenantId
     * @returns {Promise<{total, valid, invalid}>}
     */
    async verifyEmbeddings(tenantId) {
        const result = await query(`
            SELECT 
                COUNT(*)::int AS total,
                COUNT(CASE WHEN vector_dims(embedding) = $2 THEN 1 END)::int AS valid,
                COUNT(CASE WHEN vector_dims(embedding) != $2 THEN 1 END)::int AS invalid
            FROM products
            WHERE tenant_id = $1 AND embedding IS NOT NULL
        `, [tenantId, this.dimensions], tenantId);

        return result.rows[0];
    }

    /**
     * Get the average embedding for a set of products (centroid).
     * Useful for recommendation clusters or "category average" calculations.
     * @param {string} tenantId
     * @param {string[]} productIds
     * @returns {Promise<number[]>} - The centroid vector
     */
    async getCentroid(tenantId, productIds) {
        if (!productIds || productIds.length === 0) throw new Error('No product IDs provided');

        const result = await query(`
            SELECT AVG(embedding)::text AS centroid
            FROM products
            WHERE tenant_id = $1 AND id = ANY($2) AND embedding IS NOT NULL
        `, [tenantId, productIds], tenantId);

        if (!result.rows[0]?.centroid) {
            throw new Error('No embeddings found for the given products');
        }

        return JSON.parse(result.rows[0].centroid);
    }
}

module.exports = VectorEngine;
