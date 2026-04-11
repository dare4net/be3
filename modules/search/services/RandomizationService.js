/**
 * Randomization Service
 * Handles server-side resolution of randomized widget configurations
 * Ensures global uniqueness and product-awareness for a set of widgets
 */

const { query } = require('../../../config/database');
const { getRandomizationSnapshot, setRandomizationSnapshot, isRedisHealthy } = require('../../../config/redis');
const SearchService = require('./SearchService');
const CollectionService = require('../../products/services/CollectionService');

class RandomizationService {
    constructor() {
        this.searchService = new SearchService();
    }

    /**
     * Get or create a snapshot plan for a specific tenant and page
     */
    async getSnapshotPlan(tenantId, pageHandle, widgets) {
        const minuteWindow = 15;
        const bucketTimestamp = Math.floor(Date.now() / (minuteWindow * 60 * 1000));
        const bucketKey = `15m_${bucketTimestamp}`;
        const prevBucketKey = `15m_${bucketTimestamp - 1}`;

        console.log(`[RandomizationService] Checking snapshot for ${tenantId}/${pageHandle} bucket ${bucketKey}`);

        try {
            // 1. Current Bucket (Redis)
            const redisPlan = await getRandomizationSnapshot(tenantId, pageHandle, bucketKey);
            if (redisPlan) {
                console.log(`[RandomizationService] Redis HIT for ${tenantId}/${pageHandle}`);
                return { 
                    results: redisPlan, 
                    cacheId: bucketKey, 
                    expiresIn: (minuteWindow * 60) - (Math.floor(Date.now() / 1000) % (minuteWindow * 60))
                };
            }

            // 2. Current Bucket (SQL)
            const existing = await query(
                'SELECT plan_data FROM randomization_snapshots WHERE tenant_id = $1 AND page_handle = $2 AND bucket_key = $3',
                [tenantId, pageHandle, bucketKey]
            );

            if (existing.rows.length > 0) {
                console.log(`[RandomizationService] SQL HIT for ${tenantId}/${pageHandle}. Warm-loading Redis...`);
                const planData = this.parsePlanData(existing.rows[0].plan_data);
                setRandomizationSnapshot(tenantId, pageHandle, bucketKey, planData);
                return { 
                    results: planData, 
                    cacheId: bucketKey,
                    expiresIn: (minuteWindow * 60) - (Math.floor(Date.now() / 1000) % (minuteWindow * 60))
                };
            }

            // 3. Stale-While-Revalidate
            console.log(`[RandomizationService] Current snapshot MISS. Searching for stale snapshot (${prevBucketKey})...`);

            const staleRedisPlan = await getRandomizationSnapshot(tenantId, pageHandle, prevBucketKey);
            let stalePlan = staleRedisPlan;

            if (!stalePlan) {
                const prevExisting = await query(
                    'SELECT plan_data FROM randomization_snapshots WHERE tenant_id = $1 AND page_handle = $2 AND bucket_key = $3',
                    [tenantId, pageHandle, prevBucketKey]
                );
                if (prevExisting.rows.length > 0) {
                    stalePlan = this.parsePlanData(prevExisting.rows[0].plan_data);
                }
            }

            if (stalePlan) {
                console.log(`[RandomizationService] SWR TRIGGERED: Serving stale snapshot for ${tenantId}/${pageHandle}`);
                // Fire-and-forget
                this.revalidateSnapshotInBackground(tenantId, pageHandle, bucketKey, widgets).catch(e => {
                    console.error('[RandomizationService] Background revalidation fail', e);
                });
                return { 
                    results: stalePlan, 
                    cacheId: prevBucketKey, // Inform frontend it's stale
                    expiresIn: 0 
                };
            }

            // 4. Fresh Resolution
            console.log(`[RandomizationService] Absolute MISS for ${tenantId}/${pageHandle}. Resolving fresh...`);
            const plan = await this.resolveMasterPlan(tenantId, widgets);
            await this.persistSnapshot(tenantId, pageHandle, bucketKey, plan);
            return { 
                results: plan, 
                cacheId: bucketKey,
                expiresIn: (minuteWindow * 60) - (Math.floor(Date.now() / 1000) % (minuteWindow * 60))
            };

        } catch (error) {
            console.error('[RandomizationService] Snapshot management failed', error);
            const plan = await this.resolveMasterPlan(tenantId, widgets);
            return { results: plan, cacheId: 'emergency_fallback', expiresIn: 300 };
        }
    }

    /**
     * Check if a snapshot bucket is still valid
     */
    async isSnapshotValid(tenantId, pageHandle, cacheId) {
        const minuteWindow = 15;
        const bucketTimestamp = Math.floor(Date.now() / (minuteWindow * 60 * 1000));
        const currentBucketKey = `15m_${bucketTimestamp}`;

        // If the ID matches current or is the immediate next stale... (Stale window tolerance)
        return cacheId === currentBucketKey;
    }

    parsePlanData(data) {
        if (!data) return null;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) { return null; }
        }
        return data;
    }

    async persistSnapshot(tenantId, pageHandle, bucketKey, plan) {
        try {
            await Promise.all([
                query(
                    `INSERT INTO randomization_snapshots (tenant_id, page_handle, bucket_key, plan_data)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (tenant_id, page_handle, bucket_key) DO UPDATE SET plan_data = $4`,
                    [tenantId, pageHandle, bucketKey, JSON.stringify(plan)]
                ),
                setRandomizationSnapshot(tenantId, pageHandle, bucketKey, plan)
            ]);

            if (Math.random() < 0.1) {
                query(
                    'DELETE FROM randomization_snapshots WHERE tenant_id = $1 AND page_handle = $2 AND created_at < NOW() - INTERVAL \'3 hours\'',
                    [tenantId, pageHandle]
                ).catch(e => { });
            }
            console.log(`[RandomizationService] Persist success for ${bucketKey}`);
        } catch (e) {
            console.error('[RandomizationService] Persist failed', e);
        }
    }

    async revalidateSnapshotInBackground(tenantId, pageHandle, bucketKey, widgets) {
        try {
            console.log(`[RandomizationService] Background resolution starting for ${bucketKey}...`);
            const plan = await this.resolveMasterPlan(tenantId, widgets);
            await this.persistSnapshot(tenantId, pageHandle, bucketKey, plan);
            console.log(`[RandomizationService] Background revalidation complete for ${bucketKey}`);
        } catch (err) {
            console.error('[RandomizationService] Background task failed', err);
        }
    }

    /**
     * Resolve a master plan for a set of widget intents
     * @param {string} tenantId 
     * @param {Array} widgets - Array of { id, intent, config }
     */
    async resolveMasterPlan(tenantId, widgets) {
        console.log(`[RandomizationService] Resolving fresh plan for ${widgets.length} widgets`);

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
            `SELECT c.id, c.name, c.slug, c.image_url, c.parent_id
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
        const count = intent.count || intent.randomCount || 1;

        const selections = [];

        for (let i = 0; i < count; i++) {
            // Filter out types that don't have enough remaining unique items
            const viableTypes = allowedTypes.filter(type => {
                if (type === 'category') {
                    let cats = pools.categories;
                    if (intent.sourceType === 'top-level') cats = cats.filter(c => !c.parent_id);
                    else if (intent.sourceType === 'subcategories' && intent.parentCategoryId) cats = cats.filter(c => c.parent_id == intent.parentCategoryId);
                    else if (intent.sourceType === 'all-subcategories') cats = cats.filter(c => c.parent_id);
                    else if (intent.sourceType === 'manual' && intent.manualCategoryIds?.length > 0) cats = cats.filter(c => intent.manualCategoryIds.map(String).includes(String(c.id)));

                    return cats.some(c => !used.categories.has(c.id));
                }
                if (type === 'collection') return pools.collections.some(c => !used.collections.has(c.id));
                if (type === 'clause') return pools.clauses.some(c => !used.clauses.has(`${c.attribute.code}:${c.clause.name}`));
                return false;
            });

            if (viableTypes.length === 0) break;

            // Pick a type (Weighted Random / Raffle logic)
            // This prevents higher weights (like clauses) from completely dominating the page
            const weights = { 'clause': 2, 'category': 1.5, 'collection': 1 };
            
            // Calculate total weight for viable types
            const totalViableWeight = viableTypes.reduce((sum, type) => sum + (weights[type] || 0), 0);
            let random = Math.random() * totalViableWeight;
            let selectedType = 'category';

            for (const type of viableTypes) {
                const weight = weights[type] || 0;
                if (random < weight) {
                    selectedType = type;
                    break;
                }
                random -= weight;
            }

            // Handle explicit sourceType if set in config and still viable
            if (config.sourceType && viableTypes.includes(config.sourceType)) {
                if (!config.randomize?.randomizeSource) {
                    selectedType = config.sourceType;
                }
            }

            let selection = null;

            if (selectedType === 'category') {
                let available = pools.categories;

                // Rule: allowedCategories (if any)
                if (config.randomize?.allowedCategories?.length > 0) {
                    const allowedIds = config.randomize.allowedCategories.map(String);
                    available = available.filter(c => allowedIds.includes(String(c.id)));
                }

                if (intent.sourceType === 'top-level') available = available.filter(c => !c.parent_id);
                else if (intent.sourceType === 'subcategories' && intent.parentCategoryId) available = available.filter(c => c.parent_id == intent.parentCategoryId);
                else if (intent.sourceType === 'all-subcategories') available = available.filter(c => c.parent_id);
                else if (intent.sourceType === 'manual' && intent.manualCategoryIds?.length > 0) available = available.filter(c => intent.manualCategoryIds.map(String).includes(String(c.id)));

                available = available.filter(c => !used.categories.has(c.id));
                selection = available[Math.floor(Math.random() * available.length)];
                if (selection) used.categories.add(selection.id);
            } else if (selectedType === 'collection') {
                let available = pools.collections;

                // Rule: allowedCollections (if any)
                if (config.randomize?.allowedCollections?.length > 0) {
                    const allowedIds = config.randomize.allowedCollections.map(String);
                    available = available.filter(c => allowedIds.includes(String(c.id)));
                }

                available = available.filter(c => !used.collections.has(c.id));
                selection = available[Math.floor(Math.random() * available.length)];
                if (selection) used.collections.add(selection.id);
            } else if (selectedType === 'clause') {
                let available = pools.clauses;

                // Rule: allowedAttributes (if any)
                if (config.randomize?.allowedAttributes?.length > 0) {
                    const allowedCodes = config.randomize.allowedAttributes.map(String);
                    available = available.filter(c => allowedCodes.includes(String(c.attribute.code)));
                }

                available = available.filter(c => !used.clauses.has(`${c.attribute.code}:${c.clause.name}`));
                selection = available[Math.floor(Math.random() * available.length)];
                if (selection) used.clauses.add(`${selection.attribute.code}:${selection.clause.name}`);
            }

            if (selection) {
                const meta = await this.hydrateSelectionMeta(tenantId, selectedType, selection, intent);

                // Randomize Sort Order if enabled
                let resolvedSort = config.sort || 'relevance';
                if (config.randomize?.randomizeSort && config.randomize?.allowedSorts?.length > 0) {
                    const allowed = config.randomize.allowedSorts.filter(s => s !== 'random');
                    if (allowed.length > 0) {
                        resolvedSort = allowed[Math.floor(Math.random() * allowed.length)];
                    }
                }

                // Randomize Limit if enabled
                let resolvedLimit = config.limit || 8;
                if (config.randomize?.randomizeLimit && config.randomize?.limitRange) {
                    const { min = 4, max = 12 } = config.randomize.limitRange;
                    resolvedLimit = Math.floor(Math.random() * (max - min + 1)) + min;
                }

                // Randomize Featured if enabled
                let resolvedFeatured = config.showFeaturedOnly ?? false;
                if (config.randomize?.randomizeFeatured) {
                    resolvedFeatured = Math.random() > 0.5;
                }

                selections.push({
                    resolvedType: selectedType,
                    selection,
                    meta,
                    resolvedSort,
                    resolvedLimit,
                    resolvedFeatured
                });
            }
        }

        if (selections.length === 0) {
            return { widgetId: widget.id, resolvedType: 'all', selection: null, meta: null };
        }

        // Maintain compatibility: if count is 1, return flat, else return the selections array wrapper
        if (count === 1) {
            return {
                widgetId: widget.id,
                ...selections[0]
            };
        }

        return {
            widgetId: widget.id,
            multiple: true,
            selections
        };
    }

    /**
     * Build title, filters, and pretty URLs for the selection
     */
    async hydrateSelectionMeta(tenantId, type, item, intent = {}) {
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
            const eligibleCats = await this.getEligibleCategoriesForClause(tenantId, attribute.code, clause, intent);
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

    async getEligibleCategoriesForClause(tenantId, attributeCode, clause, intent = {}) {
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
            // Handle both scalar extraction (->>) and potential json-wrapped extraction (->)
            attributeCondition = `(LOWER(si.metadata->'attributes'->>$2) ${operator} LOWER($3) OR LOWER((si.metadata->'attributes'->$2)::text) ${operator} LOWER($3))`;
        } else {
            // Numeric comparison (<=, >=, <, >)
            const attrValTxt = `si.metadata->'attributes'->>$2`;
            // Safe cast check: if it looks like a number, cast it; otherwise evaluate to NULL (which makes comparison false)
            const safeAttr = `(CASE WHEN ${attrValTxt} ~ '^-?[0-9.]+$' THEN (${attrValTxt})::numeric ELSE NULL END)`;
            attributeCondition = `${safeAttr} ${operator} $3::numeric`;
        }

        const res = await query(
            `WITH RECURSIVE effective_attrs AS (
                SELECT category_id, attribute_id, tenant_id FROM category_attributes WHERE tenant_id = $1
                UNION ALL
                SELECT c.id as category_id, ea.attribute_id, c.tenant_id
                FROM categories c JOIN effective_attrs ea ON c.parent_id = ea.category_id WHERE c.tenant_id = ea.tenant_id
            )
            SELECT DISTINCT c.id, c.name, c.slug, c.image_url, c.parent_id
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
        if (excluded.length === 0) return res.rows;

        // Hierarchical Exclusion: Find all forbidden categories (excluded + descendants)
        const forbiddenRes = await query(
            `WITH RECURSIVE forbidden_tree AS (
                SELECT id FROM categories WHERE id = ANY($1::uuid[]) AND tenant_id = $2
                UNION ALL
                SELECT c.id FROM categories c 
                INNER JOIN forbidden_tree ft ON c.parent_id = ft.id
                WHERE c.tenant_id = $2
            )
            SELECT id FROM forbidden_tree`,
            [excluded, tenantId]
        );
        const forbiddenIds = new Set(forbiddenRes.rows.map(r => String(r.id)));
        const filtered = res.rows.filter(c => !forbiddenIds.has(String(c.id)));
        
        console.log(`[RandomizationService] After hierarchical exclusion filter: ${filtered.length} categories`);

        // Apply intent constraints
        let final = filtered;
        if (intent.sourceType === 'top-level') final = final.filter(c => !c.parent_id);
        else if (intent.sourceType === 'subcategories' && intent.parentCategoryId) final = final.filter(c => c.parent_id == intent.parentCategoryId);
        else if (intent.sourceType === 'all-subcategories') final = final.filter(c => c.parent_id);
        else if (intent.sourceType === 'manual' && intent.manualCategoryIds?.length > 0) final = final.filter(c => intent.manualCategoryIds.map(String).includes(String(c.id)));

        console.log(`[RandomizationService] After intent filter: ${final.length} categories`);
        return final;
    }
}

module.exports = new RandomizationService();
