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
    async expandQuery(searchQuery, tenantId, mode = 'AND') {
        if (!searchQuery || searchQuery.trim() === '') {
            return '';
        }

        // Get active synonyms for tenant
        const synonyms = await SearchSynonym.findActive(tenantId);

        if (synonyms.length === 0) {
            // No synonyms, return sanitized query
            return this.sanitizeQuery(searchQuery, mode);
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
                return `(${synonyms.map(s => s.replace(/[^\w]/g, '') + ':*').join(' | ')})`;
            }
            return cleanTerm + ':*';
        });

        const connector = mode === 'OR' ? ' | ' : ' & ';
        return expandedTerms.join(connector);
    }

    /**
     * Sanitize query for PostgreSQL tsquery
     * @param {string} query
     * @param {string} mode - 'AND' or 'OR'
     * @returns {string}
     */
    sanitizeQuery(query, mode = 'AND') {
        // Remove special characters and convert to tsquery format with prefix matching
        const connector = mode === 'OR' ? ' | ' : ' & ';
        return query
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 0)
            .map(t => t + ':*')
            .join(connector);
    }
}

module.exports = QueryProcessor;
