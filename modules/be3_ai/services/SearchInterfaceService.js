/**
 * Search Interface Service
 * 
 * The 4-stage search executor for the be3_ai pipeline.
 * Runs internally inside the backend, calling SearchService directly (no HTTP roundtrips).
 * 
 * STAGES (per category candidate):
 *   1. query + category + attributes + vendor   (most precise)
 *   2. query + category + attributes             (drop vendor)
 *   3. query + category + vendor                 (drop attributes)
 *   4. query + category                          (query + category only)
 * 
 * LOOPS:
 *   - Single (precise): stages 1→4, circuit break on first hit
 *   - Single (partial): per stage → [with category, without category], circuit break
 *   - Multiple: per stage → all categories strict=true, then all categories strict=false
 *   - None: stages 1→4 without category filter
 * 
 * CIRCUIT BREAKER: First stage to return products → stop.
 * PRICE POST-PROCESSING: Applied in-memory after circuit break.
 * 
 * PRINCIPLE: Reduce network roundtrips — all search happens in-process.
 */

const SearchService = require('../../search/services/SearchService');

class SearchInterfaceService {
    constructor() {
        this.searchService = new SearchService();
    }

    /**
     * Execute structured search.
     * 
     * @param {string} tenantId
     * @param {object} spec - Structured search specification
     * @param {string} spec.query - Search query
     * @param {Array} spec.categories - Sorted by priority [{ id, slug, label, isWinner, isPartial }]
     * @param {string} spec.categoryType - 'single' | 'none' | 'multiple'
     * @param {string|null} spec.vendor - Vendor filter (tag-based)
     * @param {object} spec.attributes - Attribute filters { code: value }
     * @param {object|null} spec.priceFilter - { min, max } for post-processing
     * @param {number} spec.limit - Results per page
     * @param {number} spec.page - Page number
     * @param {string} spec.sort - Sort order
     * @returns {object} Classified search result
     */
    async execute(tenantId, spec) {
        const {
            query: searchQuery = '',
            categories = [],
            categoryType = 'none',
            attributes = {},
            priceFilter = null,
            partialWord = null,
            limit = 5,
            page = 1,
            sort = 'relevance'
        } = spec;

        const hasQuery = searchQuery && searchQuery.trim().length > 0;

        // Vendor is an attribute value (attributes.vendor), not a separate param.
        // Split attributes into vendor vs non-vendor for stage-based filtering.
        const vendorValue = attributes.vendor || null;
        const hasVendor = vendorValue && String(vendorValue).trim().length > 0;
        const nonVendorAttrs = { ...attributes };
        delete nonVendorAttrs.vendor;
        const hasNonVendorAttrs = Object.keys(nonVendorAttrs).length > 0;
        const hasAttributes = hasVendor || hasNonVendorAttrs;

        // Build the stage definitions (ordered most -> least restrictive)
        const stages = this._buildStages(hasQuery, hasNonVendorAttrs, hasVendor);

        let result = null;

        if (categoryType === 'none') {
            result = await this._runStagesForCategory(
                tenantId, searchQuery, null, stages, attributes, nonVendorAttrs, vendorValue, limit, page, sort
            );

        } else if (categoryType === 'single') {
            const cat = categories[0];

            if (cat?.isPartial) {
                result = await this._runPartialMatchLoop(
                    tenantId, searchQuery, cat, stages, attributes, nonVendorAttrs, vendorValue, limit, page, sort, partialWord
                );
            } else {
                result = await this._runStagesForCategory(
                    tenantId, searchQuery, cat, stages, attributes, nonVendorAttrs, vendorValue, limit, page, sort
                );
            }

        } else if (categoryType === 'multiple') {
            result = await this._runMultipleCategoriesLoop(
                tenantId, searchQuery, categories, stages, attributes, nonVendorAttrs, vendorValue, limit, page, sort
            );
        }

        // Fallback: if no result was set at all
        if (!result) {
            result = this._emptyResult();
        }

        // ─── PRICE POST-PROCESSING ───
        if (priceFilter && result.products.length > 0) {
            const { min, max } = priceFilter;
            const filtered = result.products.filter(p => {
                const price = parseFloat(p.price || 0);
                if (min !== undefined && min !== null && price < min) return false;
                if (max !== undefined && max !== null && price > max) return false;
                return true;
            });

            if (filtered.length > 0) {
                result.products = filtered;
                result.total = filtered.length;
                result.price_filter_applied = true;
                result.price_filter_failed = false;
            } else {
                result.price_filter_applied = false;
                result.price_filter_failed = true;
            }
        }

        // Mark if vector fallback is needed (all stages returned 0)
        if (result.total === 0) {
            result.vector_fallback_needed = true;
        }

        return result;
    }

    /**
     * Build the stage definitions based on available parameters.
     * Stages that have no relevant params are skipped.
     */
    _buildStages(hasQuery, hasAttributes, hasVendor) {
        const stages = [];

        if (hasAttributes && hasVendor) {
            stages.push({ id: 1, useAttributes: true, useVendor: true });
        }
        if (hasAttributes) {
            stages.push({ id: 2, useAttributes: true, useVendor: false });
        }
        if (hasVendor) {
            stages.push({ id: 3, useAttributes: false, useVendor: true });
        }
        stages.push({ id: 4, useAttributes: false, useVendor: false });

        return stages;
    }

    // ═══════════════════════════════════════════════════════════════════
    // LOOP: Partial Match Category
    // Per stage: [with category] → [without category, restore partial word]
    // ═══════════════════════════════════════════════════════════════════
    async _runPartialMatchLoop(tenantId, searchQuery, category, stages, allAttrs, nonVendorAttrs, vendorValue, limit, page, sort, partialWord = null) {
        const firstStageId = stages[0]?.id;

        for (const stage of stages) {
            const stageAttrs = this._getStageAttributes(stage, allAttrs, nonVendorAttrs, vendorValue);

            // Attempt 1: WITH category
            const withCatResult = await this._executeSingleStage(
                tenantId, searchQuery, category, stage, stageAttrs, limit, page, sort, null, firstStageId
            );

            if (withCatResult && withCatResult.total > 0) {
                console.log(`[SearchInterface] Partial stage ${stage.id} hit WITH category: ${withCatResult.total} products`);
                return withCatResult;
            }

            // Attempt 2: WITHOUT category - restore the partial word back into the query
            const restoredQuery = partialWord ? `${partialWord} ${searchQuery}`.trim() : searchQuery;
            const withoutCatResult = await this._executeSingleStage(
                tenantId, restoredQuery, null, stage, stageAttrs, limit, page, sort, null, firstStageId
            );

            if (withoutCatResult && withoutCatResult.total > 0) {
                console.log(`[SearchInterface] Partial stage ${stage.id} hit WITHOUT category (partial fallback): ${withoutCatResult.total} products`);
                withoutCatResult.partialFallback = true;
                withoutCatResult.classification = withoutCatResult.classification === 'valid' ? 'suggested' : withoutCatResult.classification;
                return withoutCatResult;
            }

            console.log(`[SearchInterface] Partial stage ${stage.id} miss (both with/without category)`);
        }

        return this._emptyResult(category);
    }

    // ═══════════════════════════════════════════════════════════════════
    // LOOP: Multiple Categories
    // Per stage: all categories strict=true (AND), then all categories strict=false (OR)
    // ═══════════════════════════════════════════════════════════════════
    async _runMultipleCategoriesLoop(tenantId, searchQuery, categories, stages, allAttrs, nonVendorAttrs, vendorValue, limit, page, sort) {
        const firstStageId = stages[0]?.id;

        for (const stage of stages) {
            const stageAttrs = this._getStageAttributes(stage, allAttrs, nonVendorAttrs, vendorValue);

            // Pass 1: All categories with strict=true (AND only)
            for (const cat of categories) {
                const result = await this._executeSingleStage(
                    tenantId, searchQuery, cat, stage, stageAttrs, limit, page, sort, true, firstStageId
                );
                if (result && result.total > 0) {
                    console.log(`[SearchInterface] Multi stage ${stage.id} AND hit for "${cat.label}": ${result.total} products`);
                    return result;
                }
            }

            // Pass 2: All categories with strict=false (OR only)
            for (const cat of categories) {
                const result = await this._executeSingleStage(
                    tenantId, searchQuery, cat, stage, stageAttrs, limit, page, sort, false, firstStageId
                );
                if (result && result.total > 0) {
                    console.log(`[SearchInterface] Multi stage ${stage.id} OR hit for "${cat.label}": ${result.total} products`);
                    if (stage.id > firstStageId) {
                        result.classification = 'suggested';
                    }
                    return result;
                }
            }

            console.log(`[SearchInterface] Multi stage ${stage.id} miss (all categories, AND + OR)`);
        }

        // All stages exhausted - try without category
        for (const stage of stages) {
            const stageAttrs = this._getStageAttributes(stage, allAttrs, nonVendorAttrs, vendorValue);
            const result = await this._executeSingleStage(
                tenantId, searchQuery, null, stage, stageAttrs, limit, page, sort, null, firstStageId
            );
            if (result && result.total > 0) {
                console.log(`[SearchInterface] Multi fallback (no category) stage ${stage.id}: ${result.total} products`);
                result.classification = 'suggested';
                return result;
            }
        }

        return this._emptyResult();
    }

    // ═══════════════════════════════════════════════════════════════════
    // CORE: Run all stages sequentially for a single category
    // Used by 'none' and 'single (precise)' modes
    // ═══════════════════════════════════════════════════════════════════
    async _runStagesForCategory(tenantId, searchQuery, category, stages, allAttrs, nonVendorAttrs, vendorValue, limit, page, sort) {
        const firstStageId = stages[0]?.id;

        for (const stage of stages) {
            const stageAttrs = this._getStageAttributes(stage, allAttrs, nonVendorAttrs, vendorValue);
            const result = await this._executeSingleStage(
                tenantId, searchQuery, category, stage, stageAttrs, limit, page, sort, null, firstStageId
            );

            if (result && result.total > 0) {
                console.log(`[SearchInterface] Stage ${stage.id} hit: ${result.total} products (${result.classification})`);
                return result;
            }

            console.log(`[SearchInterface] Stage ${stage.id} miss - continuing`);
        }

        return this._emptyResult(category);
    }

    /**
     * Get the right attribute subset for a stage.
     * Stage 1: all attrs (including vendor)
     * Stage 2: non-vendor attrs only
     * Stage 3: vendor-only
     * Stage 4: no attrs
     */
    _getStageAttributes(stage, allAttrs, nonVendorAttrs, vendorValue) {
        if (stage.useAttributes && stage.useVendor) return allAttrs;
        if (stage.useAttributes && !stage.useVendor) return nonVendorAttrs;
        if (!stage.useAttributes && stage.useVendor) return vendorValue ? { vendor: vendorValue } : {};
        return {};
    }

    // ===============================================================
    // ATOMIC: Execute a single stage with given parameters
    // ===============================================================
    async _executeSingleStage(tenantId, searchQuery, category, stage, stageAttributes, limit, page, sort, strict = null, firstStageId = null) {
        const filters = {};

        if (category) {
            filters.category_id = category.id;
        }

        // Apply attributes for this stage (already subset by _getStageAttributes)
        if (stageAttributes && typeof stageAttributes === 'object') {
            for (const [code, value] of Object.entries(stageAttributes)) {
                filters[`attribute.${code}`] = value;
            }
        }

        try {
            const searchResult = await this.searchService.search(tenantId, {
                query: searchQuery || '',
                contentTypes: ['product'],
                filters,
                sort,
                page,
                perPage: limit,
                strict
            });

            const total = searchResult.pagination?.total || 0;

            if (total > 0) {
                // Classification per spec:
                // - First stage to run = always 'valid' (the most authoritative match)
                // - Stage 2 (drop vendor) = 'suggested' (same product, other vendors)
                // - Stage 3 (drop attributes) = 'suggested' (same category/vendor, different attributes)
                // - Stage 4 (query+cat only) = 'related' (broad category match)
                // BUT: if a stage IS the first to run (e.g. no vendor/attrs → stage 4 is first), it's 'valid'
                const isFirstStage = firstStageId ? stage.id === firstStageId : true;
                const classification = isFirstStage ? 'valid'
                    : stage.id <= 3 ? 'suggested'
                    : 'related';

                return {
                    products: searchResult.results || [],
                    total,
                    facets: searchResult.facets || {},
                    classification,
                    stage: stage.id,
                    category_used: category ? { id: category.id, label: category.label } : null,
                    price_filter_applied: false,
                    price_filter_failed: false,
                    vector_fallback_needed: false,
                    partialFallback: false,
                    pagination: searchResult.pagination
                };
            }

            return null;
        } catch (error) {
            console.error(`[SearchInterface] Stage ${stage.id} error:`, error.message);
            return null;
        }
    }

    /**
     * Construct an empty result object.
     */
    _emptyResult(category = null) {
        return {
            products: [],
            total: 0,
            facets: {},
            classification: 'none',
            stage: 0,
            category_used: category ? { id: category.id, label: category.label } : null,
            price_filter_applied: false,
            price_filter_failed: false,
            vector_fallback_needed: false,
            partialFallback: false,
            pagination: { page: 1, perPage: 5, total: 0, totalPages: 0 }
        };
    }
}

module.exports = SearchInterfaceService;
