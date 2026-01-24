/**
 * Query Preprocessor
 * Handles natural language query preprocessing and semantic understanding
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
        let processedQuery = searchQuery;

        // 1. Fetch all attributes with clauses for this tenant
        const attrRes = await query(
            `SELECT code, label, clauses, type FROM attributes WHERE tenant_id = $1`,
            [tenantId]
        );
        const attributes = attrRes.rows;

        // 2. Pattern matching for numeric attributes (e.g., "price under 1000", "storage above 128")
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

            // Try to find phrases like "storage under 500" or "price above 1000"
            const regex = new RegExp(`\\b(${label}|${code})\\s+(under|below|over|above|exactly|min|max)\\s+(\\$?)(\\d+)\\b`, 'i');
            const match = processedQuery.match(regex);

            if (match) {
                const operator = opPhrases[match[2].toLowerCase()];
                const value = parseInt(match[4]);

                if (attr.type === 'number') {
                    // Create synthetic clause name
                    const clauseKey = `attribute.${attr.code}:_nlq_${match[2]}_${value}`;
                    additionalFilters[clauseKey] = value;
                }

                // Remove the pattern from query
                processedQuery = processedQuery.replace(match[0], '').trim();
                break; // Only process first match
            }
        }

        // 3. Pattern matching for predefined clauses (e.g., "budget phones", "premium laptops")
        for (const attr of attributes) {
            const clauses = (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || [];

            for (const clause of clauses) {
                const keywords = Array.isArray(clause.keywords) ? clause.keywords : [];
                for (const keyword of keywords) {
                    if (searchQuery.toLowerCase().includes(keyword.toLowerCase())) {
                        const clauseKey = `attribute.${attr.code}:${clause.name}`;
                        additionalFilters[clauseKey] = clause.value ?? 1;

                        // Remove keyword from query
                        processedQuery = processedQuery.replace(new RegExp(keyword, 'gi'), '').trim();
                        break;
                    }
                }
                if (Object.keys(additionalFilters).length > 0) break;
            }
            if (Object.keys(additionalFilters).length > 0) break;
        }

        // 4. Category detection patterns (e.g., "best phones", "cheap laptops under 5000")
        const categoryPatterns = [
            /^(best|top|cheapest|affordable|premium|budget)\s+(.+)$/i,
            /^(.+)\s+(under|below|less than)\s+(\d+)$/i
        ];

        for (const pattern of categoryPatterns) {
            const match = searchQuery.match(pattern);
            if (match) {
                const potentialCategory = match[2] || match[1];

                // Try to find matching category
                const catRes = await query(
                    `SELECT id, name FROM categories 
                     WHERE tenant_id = $1 
                     AND (name ILIKE $2 OR slug ILIKE $2)
                     AND is_active = true
                     LIMIT 1`,
                    [tenantId, `%${potentialCategory}%`]
                );

                if (catRes.rows.length > 0) {
                    additionalFilters.category_id = catRes.rows[0].id;
                    processedQuery = potentialCategory; // Just search for the category name
                    break;
                }
            }
        }

        return {
            processedQuery: processedQuery || null,
            additionalFilters
        };
    }
}

module.exports = QueryPreprocessor;
