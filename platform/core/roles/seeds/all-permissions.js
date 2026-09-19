/**
 * Comprehensive Permission Definitions
 * All permissions for the eCommerce admin dashboard
 */

module.exports = {
    // ============================================
    // CATALOG PERMISSIONS
    // ============================================
    CATALOG: [
        // Products
        { name: 'products.view', module: 'catalog', description: 'View products list' },
        { name: 'products.create', module: 'catalog', description: 'Create new products' },
        { name: 'products.edit', module: 'catalog', description: 'Edit existing products' },
        { name: 'products.delete', module: 'catalog', description: 'Delete products' },
        { name: 'products.manage', module: 'catalog', description: 'Full product management' },

        // Categories
        { name: 'categories.view', module: 'catalog', description: 'View categories list' },
        { name: 'categories.create', module: 'catalog', description: 'Create new categories' },
        { name: 'categories.edit', module: 'catalog', description: 'Edit existing categories' },
        { name: 'categories.delete', module: 'catalog', description: 'Delete categories' },
        { name: 'categories.manage', module: 'catalog', description: 'Full category management' },

        // Collections
        { name: 'collections.view', module: 'catalog', description: 'View collections list' },
        { name: 'collections.create', module: 'catalog', description: 'Create new collections' },
        { name: 'collections.edit', module: 'catalog', description: 'Edit existing collections' },
        { name: 'collections.delete', module: 'catalog', description: 'Delete collections' },
        { name: 'collections.manage', module: 'catalog', description: 'Full collection management' },

        // Attributes
        { name: 'attributes.view', module: 'catalog', description: 'View product attributes' },
        { name: 'attributes.create', module: 'catalog', description: 'Create new attributes' },
        { name: 'attributes.edit', module: 'catalog', description: 'Edit existing attributes' },
        { name: 'attributes.delete', module: 'catalog', description: 'Delete attributes' },
        { name: 'attributes.manage', module: 'catalog', description: 'Full attribute management' },
    ],

    // ============================================
    // SALES PERMISSIONS
    // ============================================
    SALES: [
        // Orders
        { name: 'orders.view', module: 'sales', description: 'View orders list' },
        { name: 'orders.edit', module: 'sales', description: 'Edit order details' },
        { name: 'orders.fulfill', module: 'sales', description: 'Fulfill orders' },
        { name: 'orders.cancel', module: 'sales', description: 'Cancel orders' },
        { name: 'orders.refund', module: 'sales', description: 'Process refunds' },
        { name: 'orders.manage', module: 'sales', description: 'Full order management' },

        // Customers
        { name: 'customers.view', module: 'sales', description: 'View customers list' },
        { name: 'customers.create', module: 'sales', description: 'Create new customers' },
        { name: 'customers.edit', module: 'sales', description: 'Edit customer details' },
        { name: 'customers.delete', module: 'sales', description: 'Delete customers' },
        { name: 'customers.manage', module: 'sales', description: 'Full customer management' },
    ],

    // ============================================
    // STOREFRONT PERMISSIONS
    // ============================================
    STOREFRONT: [
        // Page Builder
        { name: 'pagebuilder.view', module: 'storefront', description: 'View page builder' },
        { name: 'pagebuilder.edit', module: 'storefront', description: 'Edit pages with page builder' },
        { name: 'pagebuilder.publish', module: 'storefront', description: 'Publish page changes' },
        { name: 'pagebuilder.manage', module: 'storefront', description: 'Full page builder access' },

        // Pages
        { name: 'pages.view', module: 'storefront', description: 'View pages list' },
        { name: 'pages.create', module: 'storefront', description: 'Create new pages' },
        { name: 'pages.edit', module: 'storefront', description: 'Edit existing pages' },
        { name: 'pages.delete', module: 'storefront', description: 'Delete pages' },
        { name: 'pages.publish', module: 'storefront', description: 'Publish/unpublish pages' },
        { name: 'pages.manage', module: 'storefront', description: 'Full page management' },

        // Layouts
        { name: 'layouts.view', module: 'storefront', description: 'View layouts' },
        { name: 'layouts.create', module: 'storefront', description: 'Create new layouts' },
        { name: 'layouts.edit', module: 'storefront', description: 'Edit existing layouts' },
        { name: 'layouts.delete', module: 'storefront', description: 'Delete layouts' },
        { name: 'layouts.manage', module: 'storefront', description: 'Full layout management' },

        // Themes
        { name: 'themes.view', module: 'storefront', description: 'View themes' },
        { name: 'themes.edit', module: 'storefront', description: 'Edit theme settings' },
        { name: 'themes.activate', module: 'storefront', description: 'Activate/switch themes' },
        { name: 'themes.manage', module: 'storefront', description: 'Full theme management' },

        // Banners
        { name: 'banners.view', module: 'storefront', description: 'View banners list' },
        { name: 'banners.create', module: 'storefront', description: 'Create new banners' },
        { name: 'banners.edit', module: 'storefront', description: 'Edit existing banners' },
        { name: 'banners.delete', module: 'storefront', description: 'Delete banners' },
        { name: 'banners.manage', module: 'storefront', description: 'Full banner management' },

        // Menus
        { name: 'menus.view', module: 'storefront', description: 'View menus' },
        { name: 'menus.edit', module: 'storefront', description: 'Edit menu structure' },
        { name: 'menus.manage', module: 'storefront', description: 'Full menu management' },

        // Search Settings
        { name: 'search.view', module: 'storefront', description: 'View search settings' },
        { name: 'search.edit', module: 'storefront', description: 'Edit search configuration' },
        { name: 'search.synonyms', module: 'storefront', description: 'Manage search synonyms' },
        { name: 'search.reindex', module: 'storefront', description: 'Rebuild search index' },
        { name: 'search.analytics', module: 'storefront', description: 'View search analytics' },
        { name: 'search.manage', module: 'storefront', description: 'Full search management' },
    ],

    // ============================================
    // SETTINGS PERMISSIONS
    // ============================================
    SETTINGS: [
        // General Settings
        { name: 'settings.view', module: 'settings', description: 'View settings' },
        { name: 'settings.edit', module: 'settings', description: 'Edit general settings' },

        // User Management
        { name: 'users.view', module: 'settings', description: 'View users list' },
        { name: 'users.create', module: 'settings', description: 'Create new users' },
        { name: 'users.edit', module: 'settings', description: 'Edit user details' },
        { name: 'users.delete', module: 'settings', description: 'Delete users' },
        { name: 'users.manage', module: 'settings', description: 'Full user management' },

        // Role & Permission Management
        { name: 'roles.view', module: 'settings', description: 'View roles' },
        { name: 'roles.create', module: 'settings', description: 'Create new roles' },
        { name: 'roles.edit', module: 'settings', description: 'Edit role permissions' },
        { name: 'roles.delete', module: 'settings', description: 'Delete roles' },
        { name: 'roles.assign', module: 'settings', description: 'Assign roles to users' },
        { name: 'roles.manage', module: 'settings', description: 'Full role management' },

        // Payment Settings
        { name: 'payments.view', module: 'settings', description: 'View payment settings' },
        { name: 'payments.edit', module: 'settings', description: 'Edit payment configuration' },

        // Shipping Settings
        { name: 'shipping.view', module: 'settings', description: 'View shipping settings' },
        { name: 'shipping.edit', module: 'settings', description: 'Edit shipping configuration' },

        // Tax Settings
        { name: 'tax.view', module: 'settings', description: 'View tax settings' },
        { name: 'tax.edit', module: 'settings', description: 'Edit tax configuration' },
    ],

    // ============================================
    // ANALYTICS PERMISSIONS
    // ============================================
    ANALYTICS: [
        { name: 'analytics.view', module: 'analytics', description: 'View analytics dashboard' },
        { name: 'analytics.export', module: 'analytics', description: 'Export analytics data' },
        { name: 'analytics.manage', module: 'analytics', description: 'Full analytics access' },
    ],

    // ============================================
    // MARKETING PERMISSIONS
    // ============================================
    MARKETING: [
        { name: 'marketing.view', module: 'marketing', description: 'View marketing features' },
        { name: 'marketing.campaigns', module: 'marketing', description: 'Manage campaigns' },
        { name: 'marketing.discounts', module: 'marketing', description: 'Manage discounts' },
        { name: 'marketing.manage', module: 'marketing', description: 'Full marketing access' },
    ],

    // ============================================
    // SYSTEM PERMISSIONS
    // ============================================
    SYSTEM: [
        { name: 'admin.access', module: 'system', description: 'Access admin dashboard' },
        { name: 'system.logs', module: 'system', description: 'View system logs' },
        { name: 'system.maintenance', module: 'system', description: 'Perform system maintenance' },
    ],
    // ============================================
    // CHAT PERMISSIONS
    // ============================================
    CHAT: [
        { name: 'chat.access', module: 'chat', description: 'Access chat inbox' },
        { name: 'chat.manage', module: 'chat', description: 'Manage all conversations' },
        { name: 'chat.settings', module: 'chat', description: 'Configure chat settings' },
    ],
    // ============================================
    // LOCATION PERMISSIONS
    // ============================================
    LOCATION: [
        { name: 'location.view', module: 'location', description: 'View business locations' },
        { name: 'location.create', module: 'location', description: 'Create new locations' },
        { name: 'location.edit', module: 'location', description: 'Edit existing locations' },
        { name: 'location.delete', module: 'location', description: 'Delete locations' },
        { name: 'location.manage', module: 'location', description: 'Full location management' },
    ],
    // ============================================
    // NOTIFICATIONS PERMISSIONS
    // ============================================
    NOTIFICATIONS: [
        { name: 'notifications.orders', module: 'notifications', description: 'Receive order notifications' },
        { name: 'notifications.payments', module: 'notifications', description: 'Receive payment notifications' },
        { name: 'notifications.all', module: 'notifications', description: 'Receive all notification types' },
    ],
};
