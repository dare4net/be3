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
                    // Add optional 's' or 'es' to the end of the phrase match
                    const regex = new RegExp(`\\b${escaped}(s|es)?\\b`, 'i');

                    if (processedQuery.match(regex)) {
                        const clauseKey = `attribute.${attr.code}:${clause.name}`;
                        additionalFilters[clauseKey] = clause.value ?? 1;
                        processedQuery = processedQuery.replace(regex, '').trim();
                        break;
                    }
                }
            }
        }

        // 4. Category detection patterns (Plural Tolerant)
        const categoryPatterns = [
            /^(best|top|cheapest|affordable|premium|budget)\s+(.+)$/i,
            /^(.+)\s+(under|below|less than)\s+(\d+)(k|m)?$/i
        ];

        for (const pattern of categoryPatterns) {
            const match = processedQuery.match(pattern);
            if (match) {
                // Fetch synonyms to help match
                const synRes = await query(`SELECT term, synonyms FROM search_synonyms WHERE tenant_id = $1 AND is_active = true`, [tenantId]);
                const synonymMap = new Map();
                synRes.rows.forEach(s => {
                    const terms = [s.term, ...(Array.isArray(s.synonyms) ? s.synonyms : [])];
                    terms.forEach(t => synonymMap.set(t.toLowerCase(), terms));
                });

                const potentialCategory = (match[2] || match[1]).trim();
                const stem = potentialCategory.replace(/(s|es)$/i, '');

                // Collect search terms including synonyms
                const searchTerms = new Set([potentialCategory.toLowerCase(), stem.toLowerCase()]);
                if (synonymMap.has(potentialCategory.toLowerCase())) {
                    synonymMap.get(potentialCategory.toLowerCase()).forEach(t => searchTerms.add(t.toLowerCase()));
                }
                if (synonymMap.has(stem.toLowerCase())) {
                    synonymMap.get(stem.toLowerCase()).forEach(t => searchTerms.add(t.toLowerCase()));
                }

                // Try to find matching category using any of the terms
                const catRes = await query(
                    `SELECT id, name FROM categories 
                     WHERE tenant_id = $1 
                     AND (name ILIKE ANY($2) OR slug ILIKE ANY($2))
                     AND is_active = true
                     LIMIT 1`,
                    [tenantId, Array.from(searchTerms).map(t => `%${t}%`)]
                );

                if (catRes.rows.length > 0) {
                    additionalFilters.category_id = catRes.rows[0].id;
                    processedQuery = processedQuery.replace(potentialCategory, '').trim();
                    break;
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
