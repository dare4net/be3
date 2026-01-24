/**
 * Query Processor
 * Handles search query expansion, sanitization, and synonym processing
 */

const SearchSynonym = require('../../models/SearchSynonym');

class QueryProcessor {
    /**
     * Expand query with synonyms
     * @param {string} searchQuery - Original search query
     * @param {string} tenantId
     * @returns {string} - Expanded query with synonyms
     */
    async expandQuery(searchQuery, tenantId) {
        if (!searchQuery || searchQuery.trim() === '') {
            return '';
        }

        // Get active synonyms for tenant
        const synonyms = await SearchSynonym.findActive(tenantId);

        if (synonyms.length === 0) {
            // No synonyms, return sanitized query
            return this.sanitizeQuery(searchQuery);
        }

        // Build synonym map
        const synonymMap = new Map();
        synonyms.forEach(syn => {
            const allTerms = [syn.term, ...syn.synonyms];
            allTerms.forEach(term => {
                if (!synonymMap.has(term.toLowerCase())) {
                    synonymMap.set(term.toLowerCase(), allTerms);
                }
            });
        });

        // Expand query terms
        const terms = searchQuery.toLowerCase().split(/\s+/);
        const expandedTerms = terms.map(term => {
            const cleanTerm = term.replace(/[^\w]/g, '');
            if (synonymMap.has(cleanTerm)) {
                const synonyms = synonymMap.get(cleanTerm);
                return `(${synonyms.join(' | ')})`;
            }
            return cleanTerm;
        });

        return expandedTerms.join(' &');
    }

    /**
     * Sanitize query for PostgreSQL tsquery
     * @param {string} query
     * @returns {string}
     */
    sanitizeQuery(query) {
        // Remove special characters and convert to tsquery format
        return query
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 0)
            .join(' & ');
    }
}

module.exports = QueryProcessor;
