/**
 * Search SEO Helper
 * Generates SEO metadata for search result pages
 */

/**
 * Generate SEO metadata for search result page
 * @param {string} query - Search query
 * @param {Object} filters - Applied filters
 * @param {Array} results - Search results
 * @param {Object} pagination - Pagination info
 * @param {string} baseUrl - Base URL for canonical URLs
 * @returns {Object} - SEO metadata
 */
function generateSearchSEO(query, filters, results, pagination, baseUrl = '') {
    const hasFilters = Object.keys(filters).length > 0;
    const filterLabels = [];

    // Build filter labels for title/description
    if (filters.category_id) {
        filterLabels.push('category');
    }
    if (filters.price_min || filters.price_max) {
        filterLabels.push('price');
    }
    if (Object.keys(filters).some(k => k.startsWith('attribute.'))) {
        filterLabels.push('attributes');
    }

    const title = hasFilters
        ? `Search Results for "${query}" - Filtered by ${filterLabels.join(', ')}`
        : `Search Results for "${query}"`;

    const description = hasFilters
        ? `Found ${pagination.total} filtered results for "${query}"`
        : `Found ${pagination.total} results for "${query}"`;

    // Build canonical URL
    const canonicalUrl = buildSearchURL(query, filters, baseUrl, { canonical: true });

    // Generate structured data (ItemList schema)
    const structuredData = generateSearchStructuredData(query, results, pagination);

    return {
        title,
        meta_description: description,
        og_title: title,
        og_description: description,
        og_type: 'website',
        og_image: null, // Could use a default search results image
        twitter_card: 'summary',
        twitter_title: title,
        twitter_description: description,
        canonical_url: canonicalUrl,
        robots: 'index,follow',
        structured_data: structuredData
    };
}

/**
 * Build search URL with query and filters
 * @param {string} query - Search query
 * @param {Object} filters - Applied filters
 * @param {string} baseUrl - Base URL
 * @param {Object} options - { canonical: boolean }
 * @returns {string}
 */
function buildSearchURL(query, filters, baseUrl = '', options = {}) {
    let params = new URLSearchParams();
    
    if (query) {
        params.set('q', query);
    }

    // Add filters to URL
    Object.keys(filters).forEach(key => {
        if (filters[key] !== null && filters[key] !== undefined && filters[key] !== '') {
            if (Array.isArray(filters[key])) {
                filters[key].forEach(val => {
                    params.append(key, val);
                });
            } else {
                params.set(key, filters[key]);
            }
        }
    });

    // For canonical URLs, sort params for consistency
    if (options.canonical) {
        const sortedParams = Array.from(params.entries()).sort((a, b) => {
            if (a[0] < b[0]) return -1;
            if (a[0] > b[0]) return 1;
            return 0;
        });
        params = new URLSearchParams(sortedParams);
    }

    const queryString = params.toString();
    return `${baseUrl}/search${queryString ? '?' + queryString : ''}`;
}

/**
 * Generate Schema.org ItemList structured data
 * @param {string} query - Search query
 * @param {Array} results - Search results
 * @param {Object} pagination - Pagination info
 * @returns {Object}
 */
function generateSearchStructuredData(query, results, pagination) {
    const itemListElement = results.map((item, index) => {
        const position = (pagination.page - 1) * pagination.perPage + index + 1;
        
        // Determine schema type based on content type
        let schemaType = 'Thing';
        if (item.content_type === 'product') {
            schemaType = 'Product';
        } else if (item.content_type === 'category') {
            schemaType = 'Category';
        } else if (item.content_type === 'page') {
            schemaType = 'WebPage';
        }

        return {
            "@type": "ListItem",
            "position": position,
            "item": {
                "@type": schemaType,
                "name": item.title,
                "url": getContentURL(item)
            }
        };
    });

    return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": `Search Results for "${query}"`,
        "description": `Found ${pagination.total} results`,
        "numberOfItems": pagination.total,
        "itemListElement": itemListElement
    };
}

/**
 * Get URL for a content item
 * @param {Object} item - Search index item
 * @returns {string}
 */
function getContentURL(item) {
    const metadata = item.metadata || {};
    
    if (item.content_type === 'product') {
        const handle = metadata.handle || item.content_id;
        return `/products/${handle}`;
    } else if (item.content_type === 'category') {
        const slug = metadata.slug || item.content_id;
        return `/categories/${slug}`;
    } else if (item.content_type === 'page') {
        const slug = metadata.slug || item.content_id;
        return `/pages/${slug}`;
    }
    
    return `/${item.content_type}/${item.content_id}`;
}

/**
 * Get schema type for content type
 * @param {string} contentType
 * @returns {string}
 */
function getSchemaType(contentType) {
    const typeMap = {
        'product': 'Product',
        'category': 'Category',
        'page': 'WebPage'
    };
    return typeMap[contentType] || 'Thing';
}

module.exports = {
    generateSearchSEO,
    buildSearchURL,
    generateSearchStructuredData,
    getContentURL,
    getSchemaType
};
