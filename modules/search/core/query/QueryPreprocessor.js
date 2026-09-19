/**
 * Query Preprocessor
 * Handles natural language query preprocessing and semantic understanding
 * Enhanced with plural tolerance and query normalization
 */

const { query } = require('../../../../config/database');

class QueryPreprocessor {
    /**
     * Preprocess query for Natural Language patterns
     * @param {string} tenantId
     * @param {string} searchQuery
     * @param {string} categoryId - Optional current category context
     * @returns {Object} - { processedQuery, additionalFilters }
     */
    async preprocessQuery(tenantId, searchQuery, categoryId = null, explicitFilters = {}) {
        if (!searchQuery) return { processedQuery: null, additionalFilters: {} };

        const additionalFilters = {};
        const debugEnabled = String(process.env.DEBUG_QUERY_PREPROCESSOR || '').toLowerCase() === 'true'
            || String(process.env.DEBUG_QUERY_PREPROCESSOR || '') === '1';

        const explicitKeys = explicitFilters && typeof explicitFilters === 'object' ? Object.keys(explicitFilters) : [];
        const hasExplicitCategory =
            !!categoryId ||
            Object.prototype.hasOwnProperty.call(explicitFilters || {}, 'category_id') ||
            Object.prototype.hasOwnProperty.call(explicitFilters || {}, 'category_ids');

        const hasExplicitAttributeCode = (attrCode) => {
            if (!attrCode) return false;
            const code = String(attrCode).toLowerCase();
            return explicitKeys.some((k) => {
                if (!k || !k.startsWith('attribute.')) return false;
                // k examples:
                // - attribute.c
                // - attribute.c:v
                // - attribute.vendor
                const rhs = k.slice('attribute.'.length);
                const existingCode = rhs.split(':')[0]?.toLowerCase();
                return existingCode === code;
            });
        };

        // 0. Initial Normalization: Strip common "junk" phrases
        let processedQuery = searchQuery
            .replace(/\b(show me|looking for|find|search for|list of|i want)\b/gi, '')
            .trim();

        // 1. Fetch all attributes with clauses for this tenant
        const attrRes = await query(
            `SELECT code, label, clauses, type FROM attributes WHERE tenant_id = $1`,
            [tenantId]
        );
        const attributes = attrRes.rows;

        // 2. Pattern matching for numeric attributes (e.g., "price under 1k", "storage above 128")
        const opPhrases = {
            'under': '<',
            'below': '<',
            'over': '>',
            'above': '>',
            'exactly': '=',
            'min': '>=',
            'max': '<='
        };

        for (const attr of attributes) {
            const label = (attr.label || '').toLowerCase();
            const code = attr.code.toLowerCase();

            // Support numeric shortcuts like '1k' -> '1000'
            const regex = new RegExp(`\\b(${label}|${code})\\s+(under|below|over|above|exactly|min|max)\\s+(\\$?)(\\d+\\.?\\d*)(k|m)?\\b`, 'i');
            const match = processedQuery.match(regex);

            if (match) {
                // If user already constrained this attribute, reject inference and keep query intact.
                if (hasExplicitAttributeCode(attr.code)) continue;

                const operatorWord = match[2].toLowerCase();
                let value = parseFloat(match[4]);
                const unit = (match[5] || '').toLowerCase();

                if (unit === 'k') value *= 1000;
                if (unit === 'm') value *= 1000000;

                const clauseKey = `attribute.${attr.code}:_nlq_${operatorWord}_${value}`;
                additionalFilters[clauseKey] = value;
                // Used inference => strip matched phrase from query.
                processedQuery = processedQuery.replace(match[0], '').trim();
            }
        }

        /**
         * Simple helper for plural-tolerant matching
         */
        const isSmartMatch = (input, target) => {
            const i = input.toLowerCase().trim();
            const t = target.toLowerCase().trim();
            if (i === t) return true;
            // Handle common English plurals
            return i === t + 's' || i === t + 'es' || t === i + 's' || t === i + 'es';
        };

        // 2.5 Match explicit Attribute: Value or Attribute: Clause patterns
        for (const attr of attributes) {
            const attrLabel = (attr.label || '').toLowerCase();
            const attrCode = attr.code.toLowerCase();

            const regex = new RegExp(`\\b(${attrLabel}|${attrCode})\\s*:\\s*(.+?)(?=\\s+\\w+:|$)`, 'i');
            const match = processedQuery.match(regex);

            if (match) {
                if (hasExplicitAttributeCode(attr.code)) continue;

                const searchValue = match[2].trim();
                const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || [];

                // Smart match for clause name or label
                const matchedClause = clauses.find(c =>
                    isSmartMatch(searchValue, c.name || '') ||
                    isSmartMatch(searchValue, c.label || '')
                );

                if (matchedClause) {
                    additionalFilters[`attribute.${attr.code}:${matchedClause.name}`] = matchedClause.value ?? 1;
                } else {
                    additionalFilters[`attribute.${attr.code}`] = searchValue;
                }
                // Used inference => strip matched substring from query.
                processedQuery = processedQuery.replace(match[0], '').trim();
            }
        }

        // 3. Pattern matching for predefined clauses (Plural Tolerant)
        for (const attr of attributes) {
            const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || [];

            for (const clause of clauses) {
                const phrases = [];
                if (clause.label) phrases.push(clause.label);
                if (clause.prefix) phrases.push(clause.prefix);
                if (clause.suffix) phrases.push(clause.suffix);
                if (Array.isArray(clause.keywords)) phrases.push(...clause.keywords);

                const validPhrases = phrases
                    .filter(p => p && typeof p === 'string' && p.trim().length > 0)
                    .sort((a, b) => b.length - a.length);

                for (const phrase of validPhrases) {
                    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`\\b${escaped}(s|es)?\\b`, 'i');

                    if (processedQuery.match(regex)) {
                        if (hasExplicitAttributeCode(attr.code)) break;

                        const clauseKey = `attribute.${attr.code}:${clause.name}`;
                        additionalFilters[clauseKey] = clause.value ?? 1;
                        // Used inference => strip matched phrase from query.
                        processedQuery = processedQuery.replace(regex, '').trim();
                        break;
                    }
                }

                // ALSO match by raw clause value (for brands/colors)
                if (typeof clause.value === 'string' || Array.isArray(clause.value)) {
                    const values = Array.isArray(clause.value) ? clause.value : [clause.value];
                    for (const val of values) {
                        if (!val) continue;
                        const escapedVal = val.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const vRegex = new RegExp(`\\b${escapedVal}(s|es)?\\b`, 'i');
                        if (processedQuery.match(vRegex)) {
                            if (hasExplicitAttributeCode(attr.code)) break;

                            const clauseKey = `attribute.${attr.code}:${clause.name}`;
                            if (!additionalFilters[clauseKey]) {
                                additionalFilters[clauseKey] = clause.value ?? 1;
                                // Used inference => strip matched value from query.
                                processedQuery = processedQuery.replace(vRegex, '').trim();
                            }
                            break;
                        }
                    }
                }
            }
        }

        // 4. Standalone Category detection (Plural Tolerant)
        // If categoryId is already known (user explicitly filtered by category), avoid re-inferencing + rewriting query.
        if (!hasExplicitCategory && processedQuery.length > 0) {
            const tokens = processedQuery.split(/\s+/).filter(t => t.length >= 3);
            if (tokens.length > 0) {
                const stems = tokens.map(t => t.replace(/(s|es)$/i, ''));
                const searchTerms = new Set([...tokens.map(t => t.toLowerCase()), ...stems.map(s => s.toLowerCase())]);

                if (debugEnabled) {
                    console.log('[QueryPreprocessor:DEBUG] categoryDetection tokens=', JSON.stringify(tokens));
                    console.log('[QueryPreprocessor:DEBUG] categoryDetection searchTerms=', JSON.stringify(Array.from(searchTerms)));
                }

                // Try to find matching category for any token
                const catRes = await query(
                    `SELECT id, name, slug FROM categories
                     WHERE tenant_id = $1
                     AND (name ILIKE ANY($2) OR slug ILIKE ANY($2))
                     AND is_active = true
                     ORDER BY length(name) DESC
                     LIMIT 1`,
                    [tenantId, Array.from(searchTerms)]
                );

                if (catRes.rows.length > 0) {
                    additionalFilters.category_id = catRes.rows[0].id;
                    if (debugEnabled) {
                        console.log('[QueryPreprocessor:DEBUG] categoryMatch=', JSON.stringify(catRes.rows[0]));
                        console.log('[QueryPreprocessor:DEBUG] strippingFromProcessedQuery(before)=', JSON.stringify(processedQuery));
                    }

                    // Used inference => strip only the tokens that actually match the resolved category name/slug.
                    const catName = String(catRes.rows[0].name || '').toLowerCase();
                    const catSlug = String(catRes.rows[0].slug || '').toLowerCase();
                    const catWords = new Set(
                        `${catName} ${catSlug}`
                            .split(/[^a-z0-9]+/g)
                            .filter(Boolean)
                    );

                    const termsToStrip = Array.from(searchTerms).filter((t) => {
                        if (!t) return false;
                        if (catWords.has(t)) return true;
                        // allow stripping of stems/prefixes that map to a category word (e.g. game -> gaming)
                        for (const w of catWords) {
                            if (w.startsWith(t)) return true;
                        }
                        return false;
                    });

                    for (const term of termsToStrip) {
                        const r = new RegExp(`\\b${term}\\b`, 'ig');
                        processedQuery = processedQuery.replace(r, ' ').replace(/\s+/g, ' ').trim();
                        if (debugEnabled) {
                            console.log('[QueryPreprocessor:DEBUG] stripped category term=', JSON.stringify(term), '-> processedQuery now=', JSON.stringify(processedQuery));
                        }
                    }

                    if (debugEnabled) {
                        console.log('[QueryPreprocessor:DEBUG] strippingFromProcessedQuery(after)=', JSON.stringify(processedQuery));
                    }
                }
            }
        }

        // Debugging (opt-in via env): prints how query was rewritten + inferred filters.
        // Enable with: DEBUG_QUERY_PREPROCESSOR=true (or 1)
        if (debugEnabled) {
            console.log('[QueryPreprocessor:DEBUG] inputQuery=', JSON.stringify(searchQuery));
            console.log('[QueryPreprocessor:DEBUG] processedQuery=', JSON.stringify(processedQuery));
            console.log('[QueryPreprocessor:DEBUG] additionalFilters=', JSON.stringify(additionalFilters));
        }

        return {
            processedQuery: processedQuery,
            additionalFilters
        };
    }
}

module.exports = QueryPreprocessor;
