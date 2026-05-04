const SeoService = require('../services/SeoService');

class SeoListeners {
    static register(eventBus) {
        // Product Events
        eventBus.registerListener('product.created', this.handleInvalidation, 'seo');
        eventBus.registerListener('product.updated', this.handleInvalidation, 'seo');
        eventBus.registerListener('product.deleted', this.handleInvalidation, 'seo');

        // Category Events
        eventBus.registerListener('category.created', this.handleInvalidation, 'seo');
        eventBus.registerListener('category.updated', this.handleInvalidation, 'seo');
        eventBus.registerListener('category.deleted', this.handleInvalidation, 'seo');

        // Collection Events
        eventBus.registerListener('collection.created', this.handleInvalidation, 'seo');
        eventBus.registerListener('collection.updated', this.handleInvalidation, 'seo');
        eventBus.registerListener('collection.deleted', this.handleInvalidation, 'seo');

        // Page Events
        eventBus.registerListener('page.created', this.handleInvalidation, 'seo');
        eventBus.registerListener('page.updated', this.handleInvalidation, 'seo');
        eventBus.registerListener('page.deleted', this.handleInvalidation, 'seo');
    }

    static async handleInvalidation(event) {
        const tenantId = event.tenantId;
        if (!tenantId) return;

        // Invalidate the cache for the tenant whenever a relevant entity is updated
        await SeoService.invalidateSitemapCache(tenantId);
    }
}

module.exports = SeoListeners;
