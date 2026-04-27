const cloudinary = require('./CloudinaryService');

/**
 * MediaInterceptor Utility
 * 
 * Provides methods to intercept record creation/updates and ensure 
 * all media URLs are hosted on Cloudinary.
 */
class MediaInterceptor {
    /**
     * Intercept a record and mirror its image field to Cloudinary
     * @param {Object} record - The record object (req.body or similar)
     * @param {string} folder - Destination folder on Cloudinary
     * @param {string} field - The field name containing the URL (default: 'image_url')
     * @param {string} oldUrl - Optional old URL for cleanup
     */
    static async intercept(record, folder = 'general', field = 'image_url', oldUrl = null) {
        if (!record || !record[field]) return record;
        
        // Skip if it's already on Cloudinary
        if (typeof record[field] === 'string' && record[field].includes('cloudinary.com')) return record;

        try {
            const newUrl = await cloudinary.mirrorExternalImage(record[field], folder, oldUrl);
            record[field] = newUrl;
        } catch (error) {
            console.error(`[MediaInterceptor] Failed to intercept ${field}:`, error.message);
        }

        return record;
    }

    /**
     * Intercept and mirror images inside a settings object
     * @param {Object} settings - The settings object
     * @param {string[]} fields - Array of keys to check for mirroring
     * @param {string} folder - Destination folder
     */
    static async interceptSettings(settings, fields = ['branding_logo', 'branding_wallpaper', 'hero_image'], folder = 'branding') {
        if (!settings || typeof settings !== 'object') return settings;

        for (const field of fields) {
            if (settings[field]) {
                await this.intercept(settings, folder, field);
            }
        }
        return settings;
    }

    /**
     * Intercept and mirror SEO/Social media fields
     */
    static async interceptSeo(record, folder = 'seo') {
        const seoFields = ['og_image', 'twitter_image'];
        for (const field of seoFields) {
            if (record[field]) {
                await this.intercept(record, folder, field);
            }
        }
        return record;
    }

    /**
     * Specialized interceptor for Attributes (handles deep nested options and swatches)
     */
    static async interceptAttribute(attribute, folder = 'attributes') {
        if (!attribute) return attribute;

        // 1. Mirror main image
        await this.intercept(attribute, folder, 'image_url');

        // 2. Mirror images within options (e.g. swatches)
        if (attribute.options && Array.isArray(attribute.options)) {
            for (const option of attribute.options) {
                if (option.image_url) {
                    await this.intercept(option, `${folder}/options`, 'image_url');
                }
            }
        }

        // 3. Mirror images within clauses
        if (attribute.clauses && Array.isArray(attribute.clauses)) {
            for (const clause of attribute.clauses) {
                if (clause.image_url) {
                    await this.intercept(clause, `${folder}/clauses`, 'image_url');
                }
            }
        }

        return attribute;
    }
}

module.exports = MediaInterceptor;
