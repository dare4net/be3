/**
 * Sort SQL Builder
 * Builds ORDER BY clauses for search results
 */

class SortSQLBuilder {
    /**
     * Build sort SQL based on sort parameter
     * @param {string} sort - 'relevance', 'price_asc', 'price_desc', 'date_desc', 'date_asc'
     * @returns {string} SQL ORDER BY clause
     */
    buildSortSQL(sort) {
        switch (sort) {
            case 'price_asc':
                return ` ORDER BY (si.metadata->>'price')::numeric ASC, rank DESC`;
            case 'price_desc':
                return ` ORDER BY (si.metadata->>'price')::numeric DESC, rank DESC`;
            case 'date_desc':
                return ` ORDER BY si.created_at DESC, rank DESC`;
            case 'date_asc':
                return ` ORDER BY si.created_at ASC, rank DESC`;
            case 'relevance':
            default:
                return ` ORDER BY rank DESC, si.created_at DESC`;
        }
    }
}

module.exports = SortSQLBuilder;
