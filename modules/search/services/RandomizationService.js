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
    async getSnapshotPlan(tenantId, pageHandle, widgets, context) {
        const minuteWindow = 15;
        const bucketTimestamp = Math.floor(Date.now() / (minuteWindow * 60 * 1000));
        const bucketKey = `15m_${bucketTimestamp}`;
        const prevBucketKey = `15m_${bucketTimestamp - 1}`;

        console.log(`[RandomizationService] Checking snapshot for ${tenantId}/${pageHandle} bucket ${bucketKey}`);

        try {
            // With vendor context, skip cache — vendor pages are unique slugs already
            // but their pools change with the ledger. Always resolve fresh if context provided.
            if (!context) {
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
                    this.revalidateSnapshotInBackground(tenantId, pageHandle, bucketKey, widgets, stalePlan).catch(e => {
                        console.error('[RandomizationService] Background revalidation fail', e);
                    });
                    return { 
                        results: stalePlan, 
                        cacheId: prevBucketKey,
                        expiresIn: 0 
                    };
                }
            }

            // 4. Fresh Resolution (always for context pages, cache-miss for others)
            // Exclude categories from the stale/previous plan to guarantee cross-window variety
            const prevCategoryIds = this.extractPlanCategoryIds(stalePlan);
            console.log(`[RandomizationService] Resolving fresh for ${tenantId}/${pageHandle} — context: ${JSON.stringify(context) || 'none'} — excluding ${prevCategoryIds.size} prev categories`);
            const plan = await this.resolveMasterPlan(tenantId, widgets, context, prevCategoryIds);

            // Only persist to cache if no context (context-aware plans use live ledger)
            if (!context) {
                await this.persistSnapshot(tenantId, pageHandle, bucketKey, plan);
            }

            return { 
                results: plan, 
                cacheId: bucketKey,
                expiresIn: (minuteWindow * 60) - (Math.floor(Date.now() / 1000) % (minuteWindow * 60))
            };

        } catch (error) {
            console.error('[RandomizationService] Snapshot management failed', error);
            const plan = await this.resolveMasterPlan(tenantId, widgets, context);
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

    async revalidateSnapshotInBackground(tenantId, pageHandle, bucketKey, widgets, prevPlan = null) {
        try {
            console.log(`[RandomizationService] Background resolution starting for ${bucketKey}...`);
            // Exclude prev window's categories so the new plan always rotates
            const prevCategoryIds = this.extractPlanCategoryIds(prevPlan);
            console.log(`[RandomizationService] Background revalidation — excluding ${prevCategoryIds.size} prev categories`);
            const plan = await this.resolveMasterPlan(tenantId, widgets, null, prevCategoryIds);
            await this.persistSnapshot(tenantId, pageHandle, bucketKey, plan);
            console.log(`[RandomizationService] Background revalidation complete for ${bucketKey}`);
        } catch (err) {
            console.error('[RandomizationService] Background task failed', err);
        }
    }

    /**
     * Extract the set of category IDs that were selected in a previous plan.
     * Used to exclude them from the next window's pool.
     */
    extractPlanCategoryIds(plan) {
        const ids = new Set();
        if (!plan) return ids;
        for (const result of plan) {
            if (result.multiple) {
                for (const s of (result.selections || [])) {
                    if (s.resolvedType === 'category' && s.selection?.id) {
                        ids.add(String(s.selection.id));
                    }
                }
            } else if (result.resolvedType === 'category' && result.selection?.id) {
                ids.add(String(result.selection.id));
            }
        }
        return ids;
    }

    /**
     * Resolve a master plan for a set of widget intents
     * @param {string} tenantId 
     * @param {Array} widgets - Array of { id, intent, config }
     */
    async resolveMasterPlan(tenantId, widgets, context, prevCategoryIds = new Set()) {
        console.log(`[RandomizationService] Resolving fresh plan for ${widgets.length} widgets (context: ${context ? JSON.stringify({ contextType: context.contextType, contextValue: context.contextValue }) : 'none'})`);

        // Calculate total categories needed across all widgets (for fallback threshold)
        const totalRequired = widgets.reduce((sum, w) => sum + (w.intent?.count || w.intent?.randomCount || 1), 0);

        // 1. Gather pools — vendor context uses ledger-filtered pools
        const pools = await this.getFreshPools(tenantId, context, prevCategoryIds, totalRequired);

        const used = {
            categories: new Set(),
            collections: new Set(),
            clauses: new Set()
        };

        // NEW: Fetch a full ancestor map for hierarchical exclusion checks
        // This ensures the hierarchy is intact even if parents don't have products directly
        const fullCatRes = await query(
            'SELECT id, parent_id FROM categories WHERE tenant_id = $1',
            [tenantId]
        );
        pools.fullHierarchyKeys = new Map(fullCatRes.rows.map(c => [String(c.id), c.parent_id ? String(c.parent_id) : null]));

        const results = [];

        // 2. Resolve each widget
        for (const widget of widgets) {
            const resolved = await this.resolveWidget(tenantId, widget, pools, used, context);
            results.push({
                widgetId: widget.id,
                ...resolved
            });
        }

        return results;
    }

    /**
     * Build clause list from attribute rows (shared helper)
     */
    buildClauses(rows) {
        const clauses = [];
        rows.forEach(attr => {
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
        return clauses;
    }

    /**
     * Get fresh pools — vendor context uses ledger; default uses full search index
     */
    async getFreshPools(tenantId, context, prevCategoryIds = new Set(), minPoolSize = 6) {
        // ── VENDOR CONTEXT: use vendor_category_ledger for fast, accurate pools ──
        if (context?.contextType === 'vendor') {
            const vendorName = context.contextValue;
            console.log(`[RandomizationService] Using vendor-filtered pools for: ${vendorName}`);

            // Step 1: Resolve vendor ID from name for the ledger lookup
            const vendorRes = await query(
                'SELECT id FROM users WHERE tenant_id = $1 AND (LOWER(business_name) = LOWER($2)) LIMIT 1',
                [tenantId, vendorName]
            );
            const vendorId = vendorRes.rows[0]?.id;

            // Step 2: get vendor's ledger categories (product-verified by ledger).
            // Uses vendor_id as primary link, falling back to vendor_name for legacy records.
            const catRes = await query(
                `SELECT c.id, c.name, c.slug, c.image_url, c.parent_id
                 FROM vendor_category_ledger vcl
                 JOIN categories c ON c.id = vcl.category_id AND c.tenant_id = vcl.tenant_id
                 WHERE vcl.tenant_id = $1 
                   AND (vcl.vendor_id = $2 OR vcl.vendor_name = $3)
                   AND vcl.product_count >= 1`,
                [tenantId, vendorId, vendorName]
            );

            const ledgerCatIds = catRes.rows.map(c => c.id.toString());

            // Step 2: parallel — vendor's own collection + attributes scoped to ledger categories
            const [collRes, attrRes] = await Promise.all([
                query(
                    `SELECT id, name, slug FROM collections
                     WHERE tenant_id = $1 AND name = $2 AND is_active = true`,
                    [tenantId, vendorName]
                ),
                ledgerCatIds.length > 0
                    ? query(
                        `SELECT DISTINCT a.id, a.code, a.label, a.clauses
                         FROM attributes a
                         WHERE a.tenant_id = $1
                           AND EXISTS (
                               SELECT 1 FROM search_indexes si
                               WHERE si.tenant_id = $1
                                 AND si.content_type = 'product'
                                 AND si.is_active = true
                                 AND si.metadata->'category_ids' ?| $2::text[]
                                 AND si.metadata->'attributes' ? a.code
                           )`,
                        [tenantId, ledgerCatIds]
                    )
                    : query(`SELECT id, code, label, clauses FROM attributes WHERE tenant_id = $1`, [tenantId])
            ]);

            console.log(`[RandomizationService] Vendor pool built — categories: ${catRes.rows.length}, attributes: ${attrRes.rows.length}, collections: ${collRes.rows.length}`);

            return {
                categories: catRes.rows,
                collections: collRes.rows,
                clauses: this.buildClauses(attrRes.rows)
            };
        }


        // ── CATEGORY CONTEXT: scope pools to context category + its descendants ──
        if (context?.contextType === 'category') {
            const categoryId = context.contextValue;
            console.log(`[RandomizationService] Using category-scoped pools for: ${categoryId}`);

            // Step 1: context category + all recursive children, filtered to only those with products
            const catTreeRes = await query(
                `WITH RECURSIVE cat_tree AS (
                    SELECT id, name, slug, image_url, parent_id
                    FROM categories
                    WHERE tenant_id = $1 AND id = $2::uuid AND is_active = true
                    UNION ALL
                    SELECT c.id, c.name, c.slug, c.image_url, c.parent_id
                    FROM categories c
                    INNER JOIN cat_tree ct ON c.parent_id = ct.id
                    WHERE c.tenant_id = $1 AND c.is_active = true
                )
                SELECT * FROM cat_tree ct
                WHERE EXISTS (
                    SELECT 1 FROM search_indexes si
                    WHERE si.tenant_id = $1
                      AND si.is_active = true
                      AND si.content_type = 'product'
                      AND si.metadata->'category_ids' ? ct.id::text
                )`,
                [tenantId, categoryId]
            );

            const catIds = catTreeRes.rows.map(c => c.id.toString());

            // Step 2: parallel — attributes with products in those categories + non-vendor collections
            const [attrRes, collRes] = await Promise.all([
                catIds.length > 0
                    ? query(
                        // Only attributes that have at least one indexed product in the category tree
                        // AND that product actually has this attribute set (not just exists in category)
                        `SELECT DISTINCT a.id, a.code, a.label, a.clauses
                         FROM attributes a
                         WHERE a.tenant_id = $1
                           AND EXISTS (
                               SELECT 1 FROM search_indexes si
                               WHERE si.tenant_id = $1
                                 AND si.content_type = 'product'
                                 AND si.is_active = true
                                 AND si.metadata->'category_ids' ?| $2::text[]
                                 AND si.metadata->'attributes' ? a.code
                           )`,
                        [tenantId, catIds]
                    )
                    : query(
                        `SELECT id, code, label, clauses FROM attributes WHERE tenant_id = $1`,
                        [tenantId]
                    ),
                // Non-vendor collections only
                query(
                    `SELECT id, name, slug FROM collections
                     WHERE tenant_id = $1 AND is_active = true
                       AND (collection_type IS NULL OR collection_type != 'vendor')`,
                    [tenantId]
                )
            ]);

            console.log(`[RandomizationService] Category pool built — categories: ${catTreeRes.rows.length}, attributes: ${attrRes.rows.length}, collections: ${collRes.rows.length}`);
            console.log(`[RandomizationService] Category IDs in pool:`, catIds);

            return {
                categories: catTreeRes.rows,
                collections: collRes.rows,
                clauses: this.buildClauses(attrRes.rows)
            };
        }

        // ── DEFAULT: full tenant pools from search index ──
        return this.getDefaultFreshPools(tenantId, prevCategoryIds, minPoolSize);

    }

    /**
     * Default full-tenant pool (original logic)
     * @param {string} tenantId
     * @param {Set<string>} prevCategoryIds - category IDs to exclude (from previous window)
     * @param {number} minPoolSize - minimum pool size before falling back to full pool
     */
    async getDefaultFreshPools(tenantId, prevCategoryIds = new Set(), minPoolSize = 6) {
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

        // Cross-window exclusion: remove categories that appeared in the previous snapshot.
        // Fall back to the full pool if excluding would leave us with less than we need.
        const allCategories = categoriesRes.rows;
        let categories = allCategories;
        if (prevCategoryIds.size > 0) {
            const filtered = allCategories.filter(c => !prevCategoryIds.has(String(c.id)));
            if (filtered.length >= minPoolSize) {
                categories = filtered;
                console.log(`[RandomizationService] Pool exclusion applied — ${allCategories.length} → ${filtered.length} categories (excluded ${prevCategoryIds.size} from prev window)`);
            } else {
                console.log(`[RandomizationService] Pool exclusion skipped — remaining (${filtered.length}) < minPoolSize (${minPoolSize}), using full pool of ${allCategories.length}`);
            }
        }

        const collectionsRes = await query(
            `SELECT id, name, slug FROM collections WHERE tenant_id = $1`,
            [tenantId]
        );

        const attributesRes = await query(
            `SELECT id, code, label, clauses FROM attributes WHERE tenant_id = $1`,
            [tenantId]
        );

        return {
            categories,
            collections: collectionsRes.rows,
            clauses: this.buildClauses(attributesRes.rows)
        };
    }

    /**
     * Resolve a single widget intent
     */
    async resolveWidget(tenantId, widget, pools, used, context = null) {
        const { intent, config } = widget;
        const allowedTypes = intent.allowedTypes || ['category', 'collection', 'clause'];
        const count = intent.count || intent.randomCount || 1;
        const isContextScoped = !!context; // pool is already scoped — skip intent filters
        console.log(`[RandomizationService] resolveWidget ${widget.id} — allowedTypes: ${JSON.stringify(allowedTypes)}, contextScoped: ${isContextScoped}, pool: { categories: ${pools.categories.length}, collections: ${pools.collections.length}, clauses: ${pools.clauses.length} }`);

        const selections = [];

        for (let i = 0; i < count; i++) {
            // Filter out types that don't have enough remaining unique items
            const viableTypes = allowedTypes.filter(type => {
                if (type === 'category') {
                    let cats = pools.categories;
                    // Only apply intent sourceType filter when NOT context-scoped.
                    // When context-scoped, the pool is already restricted to the correct tree.
                    if (!isContextScoped) {
                        if (intent.sourceType === 'top-level') cats = cats.filter(c => !c.parent_id);
                        else if (intent.sourceType === 'subcategories' && intent.parentCategoryId) cats = cats.filter(c => c.parent_id == intent.parentCategoryId);
                        else if (intent.sourceType === 'all-subcategories') cats = cats.filter(c => c.parent_id);
                        else if (intent.sourceType === 'manual' && intent.manualCategoryIds?.length > 0) cats = cats.filter(c => intent.manualCategoryIds.map(String).includes(String(c.id)));
                    }
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

                // Only apply intent sourceType filter when NOT context-scoped
                if (!isContextScoped) {
                    if (config.randomize?.allowedCategories?.length > 0) {
                        const allowedIds = config.randomize.allowedCategories.map(String);
                        available = available.filter(c => allowedIds.includes(String(c.id)));
                    }
                    if (intent.sourceType === 'top-level') available = available.filter(c => !c.parent_id);
                    else if (intent.sourceType === 'subcategories' && intent.parentCategoryId) available = available.filter(c => c.parent_id == intent.parentCategoryId);
                    else if (intent.sourceType === 'all-subcategories') available = available.filter(c => c.parent_id);
                    else if (intent.sourceType === 'manual' && intent.manualCategoryIds?.length > 0) available = available.filter(c => intent.manualCategoryIds.map(String).includes(String(c.id)));
                }

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
                if (isContextScoped) {
                    // Context-aware clause: pick category first, then find real clauses in it.
                    // This guarantees no misfires — clause value is verified to exist in products.
                    const contextualResult = await this.resolveContextualClause(
                        tenantId, pools, used
                    );
                    if (contextualResult) {
                        const resolvedSort = config.randomize?.randomizeSort && config.randomize?.allowedSorts?.length > 0
                            ? config.randomize.allowedSorts.filter(s => s !== 'random')[Math.floor(Math.random() * config.randomize.allowedSorts.filter(s => s !== 'random').length)] || config.sort || 'relevance'
                            : config.sort || 'relevance';
                        const resolvedLimit = config.randomize?.randomizeLimit && config.randomize?.limitRange
                            ? Math.floor(Math.random() * ((config.randomize.limitRange.max || 12) - (config.randomize.limitRange.min || 4) + 1)) + (config.randomize.limitRange.min || 4)
                            : config.limit || 8;
                        const resolvedFeatured = config.randomize?.randomizeFeatured ? Math.random() > 0.5 : config.showFeaturedOnly ?? false;
                        selections.push({
                            resolvedType: 'clause',
                            selection: contextualResult.selection,
                            meta: contextualResult.meta,
                            resolvedSort,
                            resolvedLimit,
                            resolvedFeatured
                        });
                    }
                    continue; // Skip normal selection/hydration flow
                }

                // Legacy: pick clause first from pool
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
                const meta = await this.hydrateSelectionMeta(tenantId, selectedType, selection, intent, pools);

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
     * Context-aware clause resolution: pick category first, then find real clauses in it.
     * Guarantees the clause value exists in actual products — no misfires.
     */
    async resolveContextualClause(tenantId, pools, used) {
        // 1. Pick an unused category from pool
        const availableCats = pools.categories.filter(c => !used.categories.has(c.id));
        if (availableCats.length === 0) {
            console.log(`[RandomizationService] resolveContextualClause: no unused categories left`);
            return null;
        }

        // Build a lookup map for ancestor traversal (id → category) from the pool
        const catMap = new Map(pools.categories.map(c => [String(c.id), c]));

        // Helper: walk up the ancestor chain to check if pickedCategory (or any ancestor)
        // is in the clause's excluded_category_ids. Uses the full hierarchy manifest.
        const isCategoryExcluded = (catId, excludedIds) => {
            if (!excludedIds?.length) return false;
            const forbidden = new Set(excludedIds.map(String));
            
            let currentId = String(catId);
            while (currentId) {
                if (forbidden.has(currentId)) return true;
                currentId = pools.fullHierarchyKeys.get(currentId) || null;
            }
            return false;
        };

        // Shuffle and try categories until we find one with valid clauses
        const shuffled = availableCats.slice().sort(() => Math.random() - 0.5);

        for (const pickedCategory of shuffled) {
            // 2. Query all (attribute_code, attribute_value) pairs that actually exist
            //    in products belonging to this specific category
            const res = await query(
                `SELECT DISTINCT
                    a.id, a.code, a.label, a.clauses,
                    kv.key   AS attr_key,
                    kv.value AS attr_val
                 FROM search_indexes si
                 JOIN LATERAL jsonb_each_text(si.metadata->'attributes') AS kv ON true
                 JOIN attributes a
                   ON a.code = kv.key AND a.tenant_id = si.tenant_id
                 WHERE si.tenant_id = $1
                   AND si.is_active = true
                   AND si.content_type = 'product'
                   AND si.metadata->'category_ids' ? $2`,
                [tenantId, pickedCategory.id.toString()]
            );

            if (res.rows.length === 0) continue;

            // 3. Intersect with configured clauses (admin-defined clause entries)
            const eligibleClauses = [];
            for (const row of res.rows) {
                const attrClauses = typeof row.clauses === 'string'
                    ? JSON.parse(row.clauses)
                    : (row.clauses || []);

                for (const clause of attrClauses) {
                    if (!clause?.name) continue;
                    const configuredVals = Array.isArray(clause.value)
                        ? clause.value.map(v => String(v).toLowerCase())
                        : [String(clause.value || '').toLowerCase()];

                    if (configuredVals.includes(String(row.attr_val || '').toLowerCase())) {
                        const key = `${row.code}:${clause.name}`;
                        if (!used.clauses.has(key)) {
                            // Respect the clause's excluded_category_ids —
                            // skip if pickedCategory or any ancestor is forbidden
                            if (isCategoryExcluded(pickedCategory.id, clause.excluded_category_ids)) continue;

                            eligibleClauses.push({
                                attribute: { id: row.id, code: row.code, label: row.label },
                                clause,
                                clauseKey: key
                            });
                        }
                    }
                }
            }

            if (eligibleClauses.length === 0) continue;

            // 4. Pick a random (attribute, clause) combo
            const picked = eligibleClauses[Math.floor(Math.random() * eligibleClauses.length)];
            used.clauses.add(picked.clauseKey);

            // 5. Build meta directly — we already have both the category and the clause
            const prefix = (picked.clause.prefix || '').trim();
            const suffix = (picked.clause.suffix || '').trim();
            const title = (prefix || suffix)
                ? `${prefix ? `${prefix} ` : ''}${pickedCategory.name}${suffix ? ` ${suffix}` : ''}`.trim()
                : (picked.clause.label || picked.clause.name);

            const slugify = t => (t || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
            const meta = {
                title,
                filter: `category_id=${pickedCategory.id}&attribute.${picked.attribute.code}:${picked.clause.name}=${Array.isArray(picked.clause.value) ? picked.clause.value[0] : (picked.clause.value || 1)}`,
                pretty_url: `/${slugify(`${prefix}${pickedCategory.slug || ''}${suffix}`)}`,
                pickedCategory
            };

            console.log(`[RandomizationService] resolveContextualClause: picked ${picked.attribute.code}=${picked.clause.name} in ${pickedCategory.name}`);
            console.log(`[RandomizationService] Generated meta for clause:`, meta);

            return {
                selection: { attribute: picked.attribute, clause: picked.clause },
                meta
            };
        }

        console.log(`[RandomizationService] resolveContextualClause: no valid clause found in any pool category`);
        return null;
    }

    /**
     * Build title, filters, and pretty URLs for the selection
     */
    async hydrateSelectionMeta(tenantId, type, item, intent = {}, pools = null) {
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

            // Restrict category pairing to only categories in the scoped pool.
            // Without this, getEligibleCategoriesForClause picks from ALL tenant categories.
            const allowedCategoryIds = pools?.categories?.map(c => c.id.toString()) || null;

            // Resolve random eligible category for the clause
            const eligibleCats = await this.getEligibleCategoriesForClause(tenantId, attribute.code, clause, intent, allowedCategoryIds);
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

    async getEligibleCategoriesForClause(tenantId, attributeCode, clause, intent = {}, allowedCategoryIds = null) {
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
        // NOTE: Do NOT early-return here even when excluded is empty.
        // Pool restriction (allowedCategoryIds) must always run.
        let filtered = res.rows;

        // Hierarchical Exclusion: Find all forbidden categories (excluded + descendants)
        if (excluded.length > 0) {
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
            filtered = filtered.filter(c => !forbiddenIds.has(String(c.id)));
        }

        console.log(`[RandomizationService] After hierarchical exclusion filter: ${filtered.length} categories`);

        // Apply intent constraints ONLY when no pool restriction is active.
        // When allowedCategoryIds is set, the pool is already correctly scoped to the context
        // category tree — applying the widget's static intent filter on top would wrongly
        // drop all categories (widget's parentCategoryId != context category).
        let final = filtered;
        if (!allowedCategoryIds?.length) {
            if (intent.sourceType === 'top-level') final = final.filter(c => !c.parent_id);
            else if (intent.sourceType === 'subcategories' && intent.parentCategoryId) final = final.filter(c => c.parent_id == intent.parentCategoryId);
            else if (intent.sourceType === 'all-subcategories') final = final.filter(c => c.parent_id);
            else if (intent.sourceType === 'manual' && intent.manualCategoryIds?.length > 0) final = final.filter(c => intent.manualCategoryIds.map(String).includes(String(c.id)));
        }

        console.log(`[RandomizationService] After intent filter: ${final.length} categories`);

        // Restrict to pool categories if a scoped pool was provided
        if (allowedCategoryIds?.length > 0) {
            const allowedSet = new Set(allowedCategoryIds.map(String));
            final = final.filter(c => allowedSet.has(String(c.id)));
            console.log(`[RandomizationService] After pool restriction: ${final.length} categories`);
        }

        return final;
    }
}

module.exports = new RandomizationService();
