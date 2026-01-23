/**
 * Rebuild Search Index - Direct Database Approach
 * This script directly calls the IndexService to rebuild the search index
 */

const IndexService = require('./modules/search/services/IndexService');
const { query } = require('./config/database');

async function getTenantId() {
    if (process.env.TENANT_ID) {
        return process.env.TENANT_ID;
    }
    const result = await query('SELECT id FROM tenants LIMIT 1');
    if (result.rows.length === 0) {
        throw new Error('No tenants found in database');
    }
    return result.rows[0].id;
}

async function rebuildSearchIndex() {
    try {
        console.log('🔍 Starting search index rebuild...\n');

        // Get the first tenant ID
        const tenantId = await getTenantId();
        console.log(`Using tenant ID: ${tenantId}\n`);

        // Create index service and rebuild
        const indexService = new IndexService();
        const result = await indexService.rebuildIndex(tenantId);

        console.log('\n✅ Search index rebuilt successfully!');
        console.log(`📊 Indexed ${result.indexedCount} items`);

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error rebuilding search index:', error.message);
        console.error(error);
        process.exit(1);
    }
}

rebuildSearchIndex();
