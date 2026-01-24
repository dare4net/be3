const routes = require('./routes');

async function bootstrap(context) {
    const { app } = context;
    // Mount routes
    app.use('/modules/banner', routes);
}

module.exports = {
    name: 'banner',
    description: 'Manage storefront banner groups and images',
    version: '1.0.0',
    bootstrap
};
