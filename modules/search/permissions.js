/**
 * Search Module Permissions
 */

module.exports = [
    { 
        name: 'search.view', 
        module: 'search', 
        description: 'View search results' 
    },
    { 
        name: 'search.manage', 
        module: 'search', 
        description: 'Manage search settings (synonyms, filters)' 
    },
    { 
        name: 'search.analytics', 
        module: 'search', 
        description: 'View search analytics' 
    },
    { 
        name: 'search.index', 
        module: 'search', 
        description: 'Rebuild search index' 
    }
];
