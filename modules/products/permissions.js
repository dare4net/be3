/**
 * Products Module Permissions
 * PRINCIPLE: All feature access is subscription-gated
 */

module.exports = {
    permissions: [
        {
            name: 'products.view',
            module: 'products',
            description: 'View products',
        },
        {
            name: 'products.create',
            module: 'products',
            description: 'Create new products',
        },
        {
            name: 'products.update',
            module: 'products',
            description: 'Update existing products',
        },
        {
            name: 'products.delete',
            module: 'products',
            description: 'Delete products',
        },
        {
            name: 'products.manage',
            module: 'products',
            description: 'Full product management access',
        },
    ],
};
