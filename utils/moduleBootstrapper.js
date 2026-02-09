/**
 * Module Bootstrapper Utility
 * 
 * PRINCIPLE: Any module can be removed without crashing the system
 * PRINCIPLE: Core runs even with zero feature modules installed
 * 
 * Dynamically loads and initializes modules based on configuration
 * Modules are completely optional and can be enabled/disabled
 */

const fs = require('fs');
const path = require('path');

class ModuleBootstrapper {
    constructor() {
        this.loadedModules = new Map();
        this.moduleRoutes = new Map();
    }

    /**
     * Load a module and its dependencies
     * @param {string} modulePath - Path to module directory
     * @param {string} moduleName - Name of the module
     * @param {Object} app - Express app instance
     * @param {Object} eventBus - Global event bus
     */
    async loadModule(modulePath, moduleName, app, eventBus) {
        try {
            // Check if module directory exists
            if (!fs.existsSync(modulePath)) {
                console.log(`[ModuleBootstrapper] Module ${moduleName} not found at ${modulePath}, skipping...`);
                return false;
            }

            // Check if module has index.js
            const indexPath = path.join(modulePath, 'index.js');
            if (!fs.existsSync(indexPath)) {
                console.log(`[ModuleBootstrapper] Module ${moduleName} has no index.js, skipping...`);
                return false;
            }

            // PRINCIPLE: Any module can be removed without crashing the system
            // We use try-catch to gracefully handle module load failures
            let module;
            try {
                module = require(indexPath);
            } catch (error) {
                console.error(`[ModuleBootstrapper] Failed to require module ${moduleName}:`, error.message);
                return false;
            }

            // Initialize module if it has a bootstrap function
            if (module.bootstrap && typeof module.bootstrap === 'function') {
                const context = {
                    app,
                    eventBus,
                    moduleName,
                };

                await module.bootstrap(context);
                console.log(`✓ Module loaded: ${moduleName}`);

                this.loadedModules.set(moduleName, module);
                return true;
            } else {
                console.warn(`[ModuleBootstrapper] Module ${moduleName} has no bootstrap function`);
                return false;
            }

        } catch (error) {
            console.error(`[ModuleBootstrapper] Error loading module ${moduleName}:`, error);
            // PRINCIPLE: Any module can be removed without crashing the system
            // Return false but don't throw - let the system continue
            return false;
        }
    }

    /**
     * Load all core platform modules
     */
    async loadCoreModules(app, eventBus) {
        const coreModules = [
            { name: 'auth', path: path.join(__dirname, '../platform/core/auth') },
            { name: 'tenants', path: path.join(__dirname, '../platform/core/tenants') },
            { name: 'roles', path: path.join(__dirname, '../platform/core/roles') },
            { name: 'subscriptions', path: path.join(__dirname, '../platform/core/subscriptions') },
            { name: 'module_registry', path: path.join(__dirname, '../platform/core/module_registry') },
            { name: 'super_admin', path: path.join(__dirname, '../super_admin') },
        ];

        console.log('\n=== Loading Core Modules ===');

        for (const module of coreModules) {
            await this.loadModule(module.path, module.name, app, eventBus);
        }
    }

    /**
     * Load all feature modules
     * PRINCIPLE: Core runs even with zero feature modules installed
     */
    async loadFeatureModules(app, eventBus) {
        const featureModules = [
            { name: 'storefront', path: path.join(__dirname, '../modules/storefront'), envVar: 'MODULE_STOREFRONT_ENABLED' },
            { name: 'products', path: path.join(__dirname, '../modules/products'), envVar: 'MODULE_PRODUCTS_ENABLED' },
            { name: 'cart', path: path.join(__dirname, '../modules/cart'), envVar: 'MODULE_CART_ENABLED' },
            { name: 'checkout', path: path.join(__dirname, '../modules/checkout'), envVar: 'MODULE_CHECKOUT_ENABLED' },
            { name: 'orders', path: path.join(__dirname, '../modules/orders'), envVar: 'MODULE_ORDERS_ENABLED' },
            { name: 'page_builder', path: path.join(__dirname, '../modules/page_builder'), envVar: 'MODULE_PAGE_BUILDER_ENABLED' },
            { name: 'payments', path: path.join(__dirname, '../modules/payments'), envVar: 'MODULE_PAYMENTS_ENABLED' },
            { name: 'shipping', path: path.join(__dirname, '../modules/shipping'), envVar: 'MODULE_SHIPPING_ENABLED' },
            { name: 'marketing', path: path.join(__dirname, '../modules/marketing'), envVar: 'MODULE_MARKETING_ENABLED' },
            { name: 'analytics', path: path.join(__dirname, '../modules/analytics'), envVar: 'MODULE_ANALYTICS_ENABLED' },
            { name: 'search', path: path.join(__dirname, '../modules/search'), envVar: 'MODULE_SEARCH_ENABLED' },
            { name: 'menus', path: path.join(__dirname, '../modules/menus'), envVar: 'MODULE_MENUS_ENABLED' },
            { name: 'banner', path: path.join(__dirname, '../modules/banner'), envVar: 'MODULE_BANNER_ENABLED' },
            { name: 'vendor', path: path.join(__dirname, '../modules/vendor'), envVar: 'MODULE_VENDOR_ENABLED' },
            { name: 'chat', path: path.join(__dirname, '../modules/chat'), envVar: 'MODULE_CHAT_ENABLED' },
            { name: 'location', path: path.join(__dirname, '../modules/location'), envVar: 'MODULE_LOCATION_ENABLED' },
        ];

        console.log('\n=== Loading Feature Modules ===');

        for (const module of featureModules) {
            // Check if module is enabled via environment variable
            const isEnabled = process.env[module.envVar] === 'true';

            if (!isEnabled) {
                console.log(`[ModuleBootstrapper] Module ${module.name} is disabled via ${module.envVar}`);
                continue;
            }

            await this.loadModule(module.path, module.name, app, eventBus);
        }
    }

    /**
     * Get list of loaded modules
     */
    getLoadedModules() {
        return Array.from(this.loadedModules.keys());
    }

    /**
     * Check if a module is loaded
     */
    isModuleLoaded(moduleName) {
        return this.loadedModules.has(moduleName);
    }
}

const bootstrapper = new ModuleBootstrapper();

module.exports = bootstrapper;
