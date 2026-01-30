/**
 * Randomization Service
 * Handles server-side resolution of randomized widget configurations
 * Ensures global uniqueness and product-awareness for a set of widgets
 */

const { query } = require('../../../config/database');
const SearchService = require('./SearchService');
const CollectionService = require('../../products/services/CollectionService');

class RandomizationService {
    constructor() {
        this.searchService = new SearchService();
    }

    /**
     * Resolve a master plan for a set of widget intents
     * @param {string} tenantId 
     * @param {Array} widgets - Array of { id, intent, config }
     */
    async resolveMasterPlan(tenantId, widgets) {
        console.log(`[RandomizationService] Resolving plan for ${widgets.length} widgets`);

        // 1. Gather all pools with product counts
        const pools = await this.getFreshPools(tenantId);

        const used = {
            categories: new Set(),
            collections: new Set(),
            clauses: new Set()
        };

        const results = [];

        // 2. Resolve each widget
        for (const widget of widgets) {
            const resolved = await this.resolveWidget(tenantId, widget, pools, used);
            results.push({
                widgetId: widget.id,
                ...resolved
            });
        }

        return results;
    }

    /**
     * Get fresh pools of valid (populated) entities
     */
    async getFreshPools(tenantId) {
        // Categories with products (including descendants)
        const categoriesRes = await query(
            `SELECT c.id, c.name, c.slug, c.image_url
             FROM categories c
             WHERE c.tenant_id = $1 AND c.is_active = true
             AND EXISTS (
                SELECT 1 FROM search_indexes si 
                WHERE si.tenant_id = $1 AND si.is_active = true 
                AND si.content_type = 'product'
                AND si.metadata->'category_ids' ? c.id::text
             )`,
            [tenantId]
        );

        // Collections (basic fetch, verification happens during resolution if needed, 
        // but for speed we'll assume active collections are intended to be shown)
        const collectionsRes = await query(
            `SELECT id, name, slug FROM collections WHERE tenant_id = $1`,
            [tenantId]
        );

        // Attributes with clauses
        const attributesRes = await query(
            `SELECT id, code, label, clauses FROM attributes WHERE tenant_id = $1`,
            [tenantId]
        );

        const clauses = [];
        attributesRes.rows.forEach(attr => {
            const attrClauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : (attr.clauses || [])) || [];
            attrClauses.forEach(clause => {
                if (clause && clause.name) {
                    clauses.push({
                        attribute: { id: attr.id, code: attr.code, label: attr.label },
                        clause: clause
                    });
                }
            });
        });

        return {
            categories: categoriesRes.rows,
            collections: collectionsRes.rows,
            clauses: clauses
        };
    }

    /**
     * Resolve a single widget intent
     */
    async resolveWidget(tenantId, widget, pools, used) {
        const { intent, config } = widget;
        const allowedTypes = intent.allowedTypes || ['category', 'collection', 'clause'];
        const count = intent.count || 1;

        const selections = [];

        for (let i = 0; i < count; i++) {
            // Filter out types that don't have enough remaining unique items
            const viableTypes = allowedTypes.filter(type => {
                if (type === 'category') return pools.categories.some(c => !used.categories.has(c.id));
                if (type === 'collection') return pools.collections.some(c => !used.collections.has(c.id));
                if (type === 'clause') return pools.clauses.some(c => !used.clauses.has(`${c.attribute.code}:${c.clause.name}`));
                return false;
            });

            if (viableTypes.length === 0) break;

            // Pick a type (Weighted: clause > category > collection)
            const weights = { 'clause': 5, 'category': 2, 'collection': 1 };
            const sortedTypes = viableTypes.sort((a, b) => (weights[b] || 0) - (weights[a] || 0));

            let selectedType = sortedTypes[0] || 'category';

            // Handle explicit sourceType if set in config and still viable
            if (config.sourceType && viableTypes.includes(config.sourceType)) {
                if (!config.randomize?.randomizeSource) {
                    selectedType = config.sourceType;
                }
            }

            let selection = null;

            if (selectedType === 'category') {
                const available = pools.categories.filter(c => !used.categories.has(c.id));
                selection = available[Math.floor(Math.random() * available.length)];
                if (selection) used.categories.add(selection.id);
            } else if (selectedType === 'collection') {
                const available = pools.collections.filter(c => !used.collections.has(c.id));
                selection = available[Math.floor(Math.random() * available.length)];
                if (selection) used.collections.add(selection.id);
            } else if (selectedType === 'clause') {
                const available = pools.clauses.filter(c => !used.clauses.has(`${c.attribute.code}:${c.clause.name}`));
                selection = available[Math.floor(Math.random() * available.length)];
                if (selection) used.clauses.add(`${selection.attribute.code}:${selection.clause.name}`);
            }

            if (selection) {
                const meta = await this.hydrateSelectionMeta(tenantId, selectedType, selection, config);

                // Randomize Sort Order if enabled
                let resolvedSort = config.sort || 'relevance';
                if (config.randomize?.randomizeSort && config.randomize?.allowedSorts?.length > 0) {
                    const allowed = config.randomize.allowedSorts.filter(s => s !== 'random'); // Avoid 'random' keyword recursion if present
                    if (allowed.length > 0) {
                        resolvedSort = allowed[Math.floor(Math.random() * allowed.length)];
                    }
                }

                selections.push({
                    resolvedType: selectedType,
                    selection,
                    meta,
                    resolvedSort
                });
            }
        }

        if (selections.length === 0) {
            return { resolvedType: 'all', selection: null, meta: null };
        }

        // Maintain compatibility: if count is 1, return flat, else return the selections array wrapper
        if (count === 1) {
            return selections[0];
        }

        return {
            multiple: true,
            selections
        };
    }

    /**
     * Build title, filters, and pretty URLs for the selection
     */
    async hydrateSelectionMeta(tenantId, type, item, config) {
        console.log(`[RandomizationService] Hydrating meta for type: ${type}`);

        if (type === 'category') {
            return {
                title: item.name,
                filter: `category_id=${item.id}`,
                pretty_url: `/${item.slug}`
            };
        }

        if (type === 'collection') {
            return {
                title: item.name,
                filter: `collection_id=${item.id}`,
                pretty_url: `/collections/${item.slug}`
            };
        }

        if (type === 'clause') {
            const { attribute, clause } = item;
            console.log(`[RandomizationService] Clause hydration - attribute: ${attribute.code}, clause: ${clause.name}`);

            // Resolve random eligible category for the clause
            const eligibleCats = await this.getEligibleCategoriesForClause(tenantId, attribute.code, clause);
            console.log(`[RandomizationService] Found ${eligibleCats.length} eligible categories for clause`);

            const pickedCat = eligibleCats[Math.floor(Math.random() * eligibleCats.length)];

            if (!pickedCat) {
                console.warn(`[RandomizationService] No eligible category found for clause ${attribute.code}:${clause.name} - returning null meta`);
                return null;
            }

            console.log(`[RandomizationService] Picked category: ${pickedCat.name} (${pickedCat.id})`);

            const prefix = (clause.prefix || '').trim();
            const suffix = (clause.suffix || '').trim();
            const title = (prefix || suffix)
                ? `${prefix ? `${prefix} ` : ''}${pickedCat.name}${suffix ? ` ${suffix}` : ''}`.trim()
                : (clause.label || clause.name);

            const slugify = (text) => (text || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
            const prettySlug = slugify(`${prefix}${pickedCat.slug || ''}${suffix}`);

            const meta = {
                title,
                filter: `category_id=${pickedCat.id}&attribute.${attribute.code}:${clause.name}=${clause.value || 1}`,
                pretty_url: `/${prettySlug}`,
                pickedCategory: pickedCat
            };

            console.log(`[RandomizationService] Generated meta for clause:`, meta);
            return meta;
        }

        return null;
    }

    async getEligibleCategoriesForClause(tenantId, attributeCode, clause) {
        console.log(`[RandomizationService] getEligibleCategoriesForClause called with:`, {
            tenantId,
            attributeCode,
            clauseName: clause.name,
            clauseValue: clause.value,
            excludedCategoryIds: clause.excluded_category_ids
        });

        const clauseValueToMatch = Array.isArray(clause.value) ? clause.value[0] : (clause.value || '1');
        const operator = clause.operator || '=';

        console.log(`[RandomizationService] Searching for attribute ${attributeCode} with value: ${clauseValueToMatch} (operator: ${operator})`);

        // Build the SQL condition based on operator
        let attributeCondition;
        if (operator === '=' || operator === '!=' || operator === 'LIKE' || operator === 'ILIKE' || operator === 'NOT LIKE') {
            // String or exact match or pattern match
            attributeCondition = `(si.metadata->'attributes'->>$2 ${operator} $3 OR (si.metadata->'attributes'->$2)::text ${operator} $3)`;
        } else {
            // Numeric comparison (<=, >=, <, >)
            attributeCondition = `(si.metadata->'attributes'->>$2)::numeric ${operator} $3::numeric`;
        }

        const res = await query(
            `WITH RECURSIVE effective_attrs AS (
                SELECT category_id, attribute_id, tenant_id FROM category_attributes WHERE tenant_id = $1
                UNION ALL
                SELECT c.id as category_id, ea.attribute_id, c.tenant_id
                FROM categories c JOIN effective_attrs ea ON c.parent_id = ea.category_id WHERE c.tenant_id = ea.tenant_id
            )
            SELECT DISTINCT c.id, c.name, c.slug, c.image_url
            FROM effective_attrs ea
            JOIN attributes a ON a.id = ea.attribute_id AND a.tenant_id = ea.tenant_id
            JOIN categories c ON c.id = ea.category_id AND c.tenant_id = ea.tenant_id
            WHERE ea.tenant_id = $1 AND a.code = $2 AND c.is_active = true
            AND EXISTS (
                SELECT 1 FROM search_indexes si 
                WHERE si.tenant_id = $1 AND si.is_active = true AND si.content_type = 'product'
                AND si.metadata->'category_ids' ? c.id::text
                AND ${attributeCondition}
            )`,
            [tenantId, attributeCode, clauseValueToMatch]
        );

        console.log(`[RandomizationService] SQL returned ${res.rows.length} categories before exclusion filter`);

        const excluded = Array.isArray(clause.excluded_category_ids) ? clause.excluded_category_ids.map(String) : [];
        console.log(`[RandomizationService] Excluded category IDs:`, excluded);

        const filtered = res.rows.filter(c => !excluded.includes(String(c.id)));
        console.log(`[RandomizationService] After exclusion filter: ${filtered.length} categories`);

        return filtered;
    }
}

module.exports = new RandomizationService();
