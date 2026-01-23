/**
 * CMS Permissions Definitions
 * Granular permissions for Pages, Widgets, Themes, and Layouts
 */

const CMS_PERMISSIONS = [
    // Pages
    { name: 'pages.view', module: 'cms', description: 'View pages list' },
    { name: 'pages.create', module: 'cms', description: 'Create new pages' },
    { name: 'pages.edit', module: 'cms', description: 'Edit existing pages' },
    { name: 'pages.delete', module: 'cms', description: 'Delete pages' },
    { name: 'pages.publish', module: 'cms', description: 'Publish/unpublish pages' },

    // Widgets
    { name: 'widgets.view', module: 'cms', description: 'View widgets' },
    { name: 'widgets.create', module: 'cms', description: 'Create widgets' },
    { name: 'widgets.edit', module: 'cms', description: 'Edit widgets' },
    { name: 'widgets.delete', module: 'cms', description: 'Delete widgets' },
    { name: 'widgets.reorder', module: 'cms', description: 'Reorder widgets' },

    // Themes
    { name: 'themes.view', module: 'cms', description: 'View themes' },
    { name: 'themes.create', module: 'cms', description: 'Create themes' },
    { name: 'themes.edit', module: 'cms', description: 'Edit themes' },
    { name: 'themes.activate', module: 'cms', description: 'Activate themes' },
    { name: 'themes.delete', module: 'cms', description: 'Delete themes' },

    // Layouts
    { name: 'layouts.view', module: 'cms', description: 'View layouts' },
    { name: 'layouts.create', module: 'cms', description: 'Create layouts' },
    { name: 'layouts.edit', module: 'cms', description: 'Edit layouts' },
    { name: 'layouts.activate', module: 'cms', description: 'Activate layouts' },
    { name: 'layouts.delete', module: 'cms', description: 'Delete layouts' }
];

module.exports = { CMS_PERMISSIONS };
