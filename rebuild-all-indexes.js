require('dotenv').config();
const { query } = require('./config/database');
const IndexService = require('./modules/search/services/IndexService');

async function rebuildAllIndexes() {
    console.log('Starting global search index rebuild...');
    try {
        const indexService = new IndexService();
        const tenants = await query('SELECT id, name FROM tenants');

        let totalIndexed = 0;
        for (const tenant of tenants.rows) {
            console.log(`\nRebuilding index for tenant: ${tenant.name} (${tenant.id})`);
            const result = await indexService.rebuildIndex(tenant.id);
            totalIndexed += result.indexedCount || 0;
        }

        console.log(`\n✅ Global index rebuild complete! Total items indexed: ${totalIndexed}`);
    } catch (error) {
        console.error('Failed to rebuild indexes:', error);
    } finally {
        process.exit();
    }
}

rebuildAllIndexes();
