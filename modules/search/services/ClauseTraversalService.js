/**
 * Clause Traversal Service
 * 
 * Generates ordered lists of clause/category pairs for ClauseGrid/CarouselWidgets.
 * Each "card" represents a branded search destination with a dynamically cached product image.
 * 
 * Supports 4 traversal modes (configurable per widget):
 *   1. category_fixed_attribute_traverse_clauses  — 1 category, 1 attribute, N clauses
 *   2. category_fixed_traverse_attributes          — 1 category, N attributes, 1 clause each
 *   3. traverse_categories_fixed_attribute          — N categories, 1 attribute, N clauses
 *   4. controlled_random                            — random picks with controlled variety
 */

const { query } = require('../../../config/database');
const ClauseImageCache = require('./ClauseImageCache');

class ClauseTraversalService {

    // ─── Shared Helpers ───────────────────────────────────────────

    slugify(text) {
        return (text || '')
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-');
    }

    /**
     * Build a card object from a category + attribute + clause triple.
     */
    buildCard(category, attribute, clause) {
        const prefix = (clause.prefix || '').trim();
        const suffix = (clause.suffix || '').trim();

        const title = (prefix || suffix)
            ? `${prefix ? `${prefix} ` : ''}${category.name}${suffix ? ` ${suffix}` : ''}`.trim()
            : (clause.label || clause.name);

        const prettySlug = this.slugify(`${prefix}${category.slug || ''}${suffix}`);
        const filterKey = `attribute.${attribute.code}:${clause.name}`;
        const filterValue = Array.isArray(clause.value) ? clause.value[0] : (clause.value ?? 1);

        return {
            title,
            pretty_url: `/${prettySlug}`,
            filter: `category_id=${category.id}&${filterKey}=${encodeURIComponent(String(filterValue))}`,
            image_url: null, // Populated later by image cache
            category: { id: category.id, name: category.name, slug: category.slug },
            attribute: { id: attribute.id, code: attribute.code, label: attribute.label },
            clause: { name: clause.name, label: clause.label, value: clause.value, prefix, suffix }
        };
    }

    /**
     * Verify that products exist for a given category + attribute + clause value
     * in the search_indexes table.
     */
    async hasProducts(tenantId, categoryId, attributeCode, clauseValue, operator = '=') {
        const normalizedValue = String(clauseValue || '').toLowerCase().trim();

        let attributeCondition;
        if (operator === '=' || !operator) {
            attributeCondition = `LOWER(si.metadata->'attributes'->>$3) = LOWER($4)`;
        } else if (['<=', '>=', '<', '>'].includes(operator)) {
            const attrVal = `si.metadata->'attributes'->>$3`;
            const safeCast = `(CASE WHEN ${attrVal} ~ '^-?[0-9.]+$' THEN (${attrVal})::numeric ELSE NULL END)`;
            attributeCondition = `${safeCast} ${operator} $4::numeric`;
        } else {
            attributeCondition = `LOWER(si.metadata->'attributes'->>$3) = LOWER($4)`;
        }

        const res = await query(
            `SELECT 1 FROM search_indexes si
             WHERE si.tenant_id = $1 AND si.is_active = true AND si.content_type = 'product'
               AND si.metadata->'category_ids' ? $2
               AND ${attributeCondition}
             LIMIT 1`,
            [tenantId, String(categoryId), attributeCode, normalizedValue]
        );

        return res.rows.length > 0;
    }

    /**
     * Check hierarchical exclusion — is this category (or any ancestor) in the clause's excluded list?
     */
    async isCategoryExcluded(tenantId, categoryId, excludedCategoryIds) {
        if (!excludedCategoryIds || excludedCategoryIds.length === 0) return false;

        const res = await query(
            `WITH RECURSIVE forbidden_tree AS (
                SELECT id FROM categories WHERE id = ANY($1::uuid[]) AND tenant_id = $2
                UNION ALL
                SELECT c.id FROM categories c
                INNER JOIN forbidden_tree ft ON c.parent_id = ft.id
                WHERE c.tenant_id = $2
            )
            SELECT 1 FROM forbidden_tree WHERE id = $3 LIMIT 1`,
            [excludedCategoryIds.map(String), tenantId, categoryId]
        );

        return res.rows.length > 0;
    }

    /**
     * Fetch attributes linked to a category (including inherited from parent chain).
     */
    async getLinkedAttributes(tenantId, categoryId) {
        const res = await query(
            `WITH RECURSIVE ancestor_chain AS (
                -- Start from the given category
                SELECT id, parent_id FROM categories WHERE tenant_id = $1 AND id = $2
                UNION ALL
                -- Walk UP to parent categories
                SELECT c.id, c.parent_id FROM categories c
                JOIN ancestor_chain ac ON c.id = ac.parent_id
                WHERE c.tenant_id = $1
            )
            SELECT DISTINCT a.id, a.code, a.label, a.clauses
            FROM category_attributes ca
            JOIN ancestor_chain ac ON ca.category_id = ac.id
            JOIN attributes a ON a.id = ca.attribute_id AND a.tenant_id = $1
            WHERE ca.tenant_id = $1 AND a.clauses IS NOT NULL`,
            [tenantId, categoryId]
        );
        return res.rows;
    }

    /**
     * Parse the clauses JSON from an attribute row.
     */
    parseClauses(attr) {
        const raw = typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : (attr.clauses || []);
        return (raw || []).filter(c => c && c.name);
    }

    /**
     * Resolve categories from a sourceType config.
     */
    async resolveCategories(tenantId, { categoryIds, sourceType, parentCategoryId }) {
        if (categoryIds && categoryIds.length > 0) {
            const res = await query(
                `SELECT id, name, slug, image_url, parent_id
                 FROM categories WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND is_active = true`,
                [tenantId, categoryIds]
            );
            return res.rows;
        }

        if (sourceType === 'top-level') {
            const res = await query(
                `SELECT id, name, slug, image_url, parent_id
                 FROM categories WHERE tenant_id = $1 AND parent_id IS NULL AND is_active = true`,
                [tenantId]
            );
            return res.rows;
        }

        if (sourceType === 'subcategories' && parentCategoryId) {
            const res = await query(
                `SELECT id, name, slug, image_url, parent_id
                 FROM categories WHERE tenant_id = $1 AND parent_id = $2 AND is_active = true`,
                [tenantId, parentCategoryId]
            );
            return res.rows;
        }

        if (sourceType === 'descendants' && parentCategoryId) {
            const res = await query(
                `WITH RECURSIVE cat_tree AS (
                    SELECT id, name, slug, image_url, parent_id
                    FROM categories WHERE tenant_id = $1 AND id = $2 AND is_active = true
                    UNION ALL
                    SELECT c.id, c.name, c.slug, c.image_url, c.parent_id
                    FROM categories c
                    INNER JOIN cat_tree ct ON c.parent_id = ct.id
                    WHERE c.tenant_id = $1 AND c.is_active = true
                )
                SELECT * FROM cat_tree`,
                [tenantId, parentCategoryId]
            );
            return res.rows;
        }

        // Default: all active categories
        const res = await query(
            `SELECT id, name, slug, image_url, parent_id
             FROM categories WHERE tenant_id = $1 AND is_active = true`,
            [tenantId]
        );
        return res.rows;
    }

    /**
     * Populate image_url for all cards in parallel using ClauseImageCache.
     */
    async populateImages(tenantId, cards) {
        await Promise.all(cards.map(async (card) => {
            const clauseValue = Array.isArray(card.clause.value)
                ? card.clause.value[0]
                : (card.clause.value ?? '1');

            card.image_url = await ClauseImageCache.getClauseImage(
                tenantId,
                card.category.id,
                card.attribute.code,
                clauseValue
            );
        }));
        return cards;
    }

    // ─── Main Entry Point ─────────────────────────────────────────

    /**
     * Generate clause/category cards based on the traversal mode.
     * 
     * @param {string} tenantId
     * @param {object} config - Traversal configuration
     * @param {string} config.mode - Traversal mode
     * @param {string} [config.categoryId] - For modes 1, 2, 4
     * @param {string[]} [config.categoryIds] - For mode 3
     * @param {string} [config.sourceType] - For modes 3, 4
     * @param {string} [config.parentCategoryId] - When sourceType=subcategories/descendants
     * @param {string} [config.attributeCode] - For modes 1, 3
     * @param {number} [config.maxItems=12] - Max cards to return
     * @param {boolean} [config.allowRepeatAttribute=false] - For mode 4
     * @returns {Promise<Array>} Array of card objects
     */
    async traverse(tenantId, config) {
        const { mode, maxItems = 12 } = config;

        let cards = [];

        switch (mode) {
            case 'category_fixed_attribute_traverse_clauses':
                cards = await this.mode1(tenantId, config);
                break;
            case 'category_fixed_traverse_attributes':
                cards = await this.mode2(tenantId, config);
                break;
            case 'traverse_categories_fixed_attribute':
                cards = await this.mode3(tenantId, config);
                break;
            case 'controlled_random':
                cards = await this.mode4(tenantId, config);
                break;
            default:
                console.warn(`[ClauseTraversalService] Unknown mode: ${mode}`);
                return [];
        }

        // Limit
        cards = cards.slice(0, maxItems);

        // Populate images in parallel
        await this.populateImages(tenantId, cards);

        return cards;
    }


    // ─── Mode 1: Category Fixed, Attribute Fixed, Traverse Clauses ──

    /**
     * Fix one category + one attribute → iterate through all its clauses.
     * e.g., Laptops → [Brand] → Apple Laptops, Dell Laptops, HP Laptops
     */
    async mode1(tenantId, { categoryId, attributeCode }) {
        if (!categoryId || !attributeCode) return [];

        // Fetch category
        const catRes = await query(
            `SELECT id, name, slug, image_url FROM categories WHERE tenant_id = $1 AND id = $2 AND is_active = true`,
            [tenantId, categoryId]
        );
        const category = catRes.rows[0];
        if (!category) return [];

        // Fetch attribute
        const attrRes = await query(
            `SELECT id, code, label, clauses FROM attributes WHERE tenant_id = $1 AND code = $2`,
            [tenantId, attributeCode]
        );
        const attr = attrRes.rows[0];
        if (!attr) return [];

        const clauses = this.parseClauses(attr);
        const cards = [];

        for (const clause of clauses) {
            // Check exclusion
            if (await this.isCategoryExcluded(tenantId, categoryId, clause.excluded_category_ids)) continue;

            // Verify products exist
            const clauseValue = Array.isArray(clause.value) ? clause.value[0] : (clause.value ?? '1');
            if (!(await this.hasProducts(tenantId, categoryId, attributeCode, clauseValue, clause.operator))) continue;

            cards.push(this.buildCard(category, attr, clause));
        }

        return cards;
    }


    // ─── Mode 2: Category Fixed, Traverse Attributes ────────────────

    /**
     * Fix one category → iterate through all linked attributes → pick first valid clause per attribute.
     * e.g., Laptops → [Brand, Storage, Color, Price] → Apple Laptops, High Storage Laptops, etc.
     */
    async mode2(tenantId, { categoryId }) {
        if (!categoryId) return [];

        // Fetch category
        const catRes = await query(
            `SELECT id, name, slug, image_url FROM categories WHERE tenant_id = $1 AND id = $2 AND is_active = true`,
            [tenantId, categoryId]
        );
        const category = catRes.rows[0];
        if (!category) return [];

        // Fetch all attributes linked to this category (inherited)
        const attrs = await this.getLinkedAttributes(tenantId, categoryId);
        const cards = [];

        for (const attr of attrs) {
            const clauses = this.parseClauses(attr);

            // Shuffle to get variety
            const shuffled = clauses.slice().sort(() => Math.random() - 0.5);

            for (const clause of shuffled) {
                if (await this.isCategoryExcluded(tenantId, categoryId, clause.excluded_category_ids)) continue;

                const clauseValue = Array.isArray(clause.value) ? clause.value[0] : (clause.value ?? '1');
                if (!(await this.hasProducts(tenantId, categoryId, attr.code, clauseValue, clause.operator))) continue;

                cards.push(this.buildCard(category, attr, clause));
                break; // Only one clause per attribute in this mode
            }
        }

        return cards;
    }


    // ─── Mode 3: Traverse Categories, Fixed Attribute ───────────────

    /**
     * Multiple categories + one attribute → iterate clauses per category.
     * e.g., [Laptops, Smartphones, Desktops] → [Brand] → Apple Laptops, Samsung Smartphones, Dell Desktops
     */
    async mode3(tenantId, { categoryIds, sourceType, parentCategoryId, attributeCode }) {
        if (!attributeCode) return [];

        // Resolve category list
        const categories = await this.resolveCategories(tenantId, { categoryIds, sourceType, parentCategoryId });
        if (categories.length === 0) return [];

        // Fetch attribute
        const attrRes = await query(
            `SELECT id, code, label, clauses FROM attributes WHERE tenant_id = $1 AND code = $2`,
            [tenantId, attributeCode]
        );
        const attr = attrRes.rows[0];
        if (!attr) return [];

        const clauses = this.parseClauses(attr);
        const cards = [];

        for (const category of categories) {
            for (const clause of clauses) {
                if (await this.isCategoryExcluded(tenantId, category.id, clause.excluded_category_ids)) continue;

                const clauseValue = Array.isArray(clause.value) ? clause.value[0] : (clause.value ?? '1');
                if (!(await this.hasProducts(tenantId, category.id, attributeCode, clauseValue, clause.operator))) continue;

                cards.push(this.buildCard(category, attr, clause));
            }
        }

        return cards;
    }


    // ─── Mode 4: Controlled Random ──────────────────────────────────

    /**
     * Random picks with controlled variety.
     * Pool from category + descendants (or any), random attribute (controlled repetition), any clause.
     */
    async mode4(tenantId, { categoryId, categoryIds, sourceType, parentCategoryId, maxItems = 12, allowRepeatAttribute = false }) {
        // Resolve category pool
        let categories;
        if (categoryId) {
            // Category + descendants
            categories = await this.resolveCategories(tenantId, {
                sourceType: 'descendants',
                parentCategoryId: categoryId
            });
        } else {
            categories = await this.resolveCategories(tenantId, { categoryIds, sourceType, parentCategoryId });
        }

        if (categories.length === 0) return [];

        // Fetch all attributes for this tenant that have clauses
        const attrRes = await query(
            `SELECT id, code, label, clauses FROM attributes WHERE tenant_id = $1 AND clauses IS NOT NULL`,
            [tenantId]
        );
        const allAttrs = attrRes.rows;
        if (allAttrs.length === 0) return [];

        const cards = [];
        const usedAttributes = new Set();
        const usedPairs = new Set(); // "categoryId:attrCode:clauseName" to avoid exact dupes

        // Shuffle categories for variety
        const shuffledCats = categories.slice().sort(() => Math.random() - 0.5);

        for (const category of shuffledCats) {
            if (cards.length >= maxItems) break;

            // Shuffle attributes for this category
            const shuffledAttrs = allAttrs.slice().sort(() => Math.random() - 0.5);

            for (const attr of shuffledAttrs) {
                if (cards.length >= maxItems) break;
                if (!allowRepeatAttribute && usedAttributes.has(attr.code)) continue;

                const clauses = this.parseClauses(attr);
                const shuffledClauses = clauses.slice().sort(() => Math.random() - 0.5);

                for (const clause of shuffledClauses) {
                    if (cards.length >= maxItems) break;

                    const pairKey = `${category.id}:${attr.code}:${clause.name}`;
                    if (usedPairs.has(pairKey)) continue;

                    if (await this.isCategoryExcluded(tenantId, category.id, clause.excluded_category_ids)) continue;

                    const clauseValue = Array.isArray(clause.value) ? clause.value[0] : (clause.value ?? '1');
                    if (!(await this.hasProducts(tenantId, category.id, attr.code, clauseValue, clause.operator))) continue;

                    cards.push(this.buildCard(category, attr, clause));
                    usedAttributes.add(attr.code);
                    usedPairs.add(pairKey);
                    break; // Move to next attribute (or next category)
                }
            }
        }

        return cards;
    }
}

module.exports = new ClauseTraversalService();
