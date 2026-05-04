const seoRoutes = require('./routes/seo.routes');
const listeners = require('./events/listeners');

async function bootstrap(context) {
    const { app, eventBus } = context;

    // Register event listeners for cache invalidation
    if (eventBus) {
        listeners.register(eventBus);
    }

    // Mount module routes
    app.use('/seo', seoRoutes);
}

module.exports = {
    name: 'seo',
    description: 'Handles full SEO functionality including sitemap generation and presets',
    version: '1.0.0',
    bootstrap
};
