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
    async preprocessQuery(tenantId, searchQuery, categoryId = null) {
        if (!searchQuery) return { processedQuery: null, additionalFilters: {} };

        const additionalFilters = {};

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
                const operatorWord = match[2].toLowerCase();
                let value = parseFloat(match[4]);
                const unit = (match[5] || '').toLowerCase();

                if (unit === 'k') value *= 1000;
                if (unit === 'm') value *= 1000000;

                const clauseKey = `attribute.${attr.code}:_nlq_${operatorWord}_${value}`;
                additionalFilters[clauseKey] = value;
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
                        const clauseKey = `attribute.${attr.code}:${clause.name}`;
                        additionalFilters[clauseKey] = clause.value ?? 1;
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
                            const clauseKey = `attribute.${attr.code}:${clause.name}`;
                            if (!additionalFilters[clauseKey]) {
                                additionalFilters[clauseKey] = clause.value ?? 1;
                                processedQuery = processedQuery.replace(vRegex, '').trim();
                            }
                            break;
                        }
                    }
                }
            }
        }

        // 4. Standalone Category detection (Plural Tolerant)
        if (processedQuery.length > 0) {
            const tokens = processedQuery.split(/\s+/).filter(t => t.length >= 3);
            if (tokens.length > 0) {
                const stems = tokens.map(t => t.replace(/(s|es)$/i, ''));
                const searchTerms = new Set([...tokens.map(t => t.toLowerCase()), ...stems.map(s => s.toLowerCase())]);

                // Try to find matching category for any token
                const catRes = await query(
                    `SELECT id, name FROM categories
                     WHERE tenant_id = $1
                     AND (name ILIKE ANY($2) OR slug ILIKE ANY($2))
                     AND is_active = true
                     ORDER BY length(name) DESC
                     LIMIT 1`,
                    [tenantId, Array.from(searchTerms)]
                );

                if (catRes.rows.length > 0) {
                    additionalFilters.category_id = catRes.rows[0].id;
                    // Remove matching word from query
                    for (const term of searchTerms) {
                        const r = new RegExp(`\\b${term}\\b`, 'i');
                        processedQuery = processedQuery.replace(r, '').trim();
                    }
                }
            }
        }

        return {
            processedQuery: processedQuery,
            additionalFilters
        };
    }
}

module.exports = QueryPreprocessor;
