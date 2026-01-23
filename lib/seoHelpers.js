/**
 * SEO Inheritance Helper
 * Resolves product SEO by falling back to category SEO where product fields are null
 */

/**
 * Merge product SEO with category SEO (inheritance)
 * @param {Object} product - Product with SEO fields
 * @param {Object} category - Category with SEO fields (optional)
 * @returns {Object} - Merged SEO data with product overriding category
 */
function mergeProductSEO(product, category = null) {
    // If no category, just return product SEO
    if (!category) {
        return {
            title: product.name,
            meta_description: product.meta_description || product.description,
            og_title: product.og_title || product.name,
            og_description: product.og_description || product.meta_description || product.description,
            og_image: product.og_image || product.image_url,
            og_type: 'product', //Always product type
            twitter_card: product.twitter_card || 'summary_large_image',
            twitter_title: product.twitter_title || product.og_title || product.name,
            twitter_description: product.twitter_description || product.og_description || product.meta_description,
            twitter_image: product.twitter_image || product.og_image || product.image_url,
            canonical_url: product.canonical_url || null,
            robots: product.robots || 'index,follow',
            structured_data: product.structured_data || generateProductSchema(product)
        };
    }

    // Inherit from category where product fields are null
    return {
        title: product.name,
        meta_description: product.meta_description || category.meta_description || product.description,

        // Open Graph - inherit from category
        og_title: product.og_title || product.name,
        og_description: product.og_description || product.meta_description || category.og_description || product.description,
        og_image: product.og_image || product.image_url || category.og_image,
        og_type: 'product',

        // Twitter - inherit from category
        twitter_card: product.twitter_card || category.twitter_card || 'summary_large_image',
        twitter_title: product.twitter_title || product.og_title || product.name,
        twitter_description: product.twitter_description || product.og_description || category.twitter_description,
        twitter_image: product.twitter_image || product.og_image || product.image_url || category.twitter_image,

        // SEO settings
        canonical_url: product.canonical_url || null,
        robots: product.robots || category.robots || 'index,follow',

        // Structured data - merge product schema with category hints
        structured_data: product.structured_data || generateProductSchema(product, category)
    };
}

/**
 * Generate Schema.org Product structured data
 * @param {Object} product 
 * @param {Object} category - Optional category for breadcrumbs
 * @returns {Object} - JSON-LD structured data
 */
function generateProductSchema(product, category = null) {
    const schema = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": product.name,
        "description": product.description || product.meta_description,
        "sku": product.sku,
        "image": product.image_url || product.og_image
    };

    // Add price if available
    if (product.price) {
        schema.offers = {
            "@type": "Offer",
            "price": product.price,
            "priceCurrency": "USD", // TODO: Make dynamic
            "availability": product.inventory_quantity > 0
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock"
        };
    }

    // Add category breadcrumb if available
    if (category) {
        schema.category = category.name;
    }

    return schema;
}

/**
 * Merge category SEO with defaults
 * @param {Object} category - Category with SEO fields
 * @returns {Object} - Complete SEO data
 */
function mergeCategorySEO(category) {
    return {
        title: category.name,
        meta_description: category.meta_description || category.description,
        og_title: category.og_title || category.name,
        og_description: category.og_description || category.meta_description || category.description,
        og_image: category.og_image || category.image_url,
        og_type: category.og_type || 'website', // 'product.group' for commerce
        twitter_card: category.twitter_card || 'summary_large_image',
        twitter_title: category.twitter_title || category.og_title || category.name,
        twitter_description: category.twitter_description || category.og_description || category.meta_description,
        twitter_image: category.twitter_image || category.og_image || category.image_url,
        canonical_url: category.canonical_url || null,
        robots: category.robots || 'index,follow',
        structured_data: category.structured_data || generateCategorySchema(category)
    };
}

/**
 * Generate Schema.org ItemList for category pages
 * @param {Object} category 
 * @returns {Object} - JSON-LD structured data
 */
function generateCategorySchema(category) {
    return {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": category.name,
        "description": category.description || category.meta_description
    };
}

/**
 * Generate SEO for branded landing pages (Pretty URLs)
 * @param {Object} category - Resolved category
 * @param {Object} attribute - Resolved attribute
 * @param {Object} clause - Resolved clause
 * @param {string} baseUrl - Base URL for canonical
 * @returns {Object} - Complete SEO metadata
 */
function generateBrandedSEO(category, attribute, clause, baseUrl = '') {
    const prefix = clause.prefix || '';
    const suffix = clause.suffix || '';
    const title = `${prefix}${category.name}${suffix}`.trim();

    // Description logic
    let description = clause.seo_template || '';
    if (description) {
        description = description.replace(/\[Category\]/g, category.name);
        description = description.replace(/\[Attribute\]/g, attribute.label);
        description = description.replace(/\[Title\]/g, title);
    } else {
        description = `Discover our curated selection of ${title}. Browse the best ${category.name} with ${attribute.label} matching your needs.`.trim();
    }

    return {
        title,
        meta_description: description,
        og_title: title,
        og_description: description,
        og_image: category.image_url || category.og_image || null,
        og_type: 'website',
        twitter_card: 'summary_large_image',
        twitter_title: title,
        twitter_description: description,
        twitter_image: category.image_url || category.og_image || null,
        canonical_url: baseUrl ? `${baseUrl}/${clause.slug || ''}` : null,
        robots: 'index,follow',
        structured_data: {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": title,
            "description": description,
            "image": category.image_url
        }
    };
}

module.exports = {
    mergeProductSEO,
    mergeCategorySEO,
    generateProductSchema,
    generateCategorySchema,
    generateBrandedSEO
};
