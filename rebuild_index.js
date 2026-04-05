const { query } = require('./config/database');
const IndexService = require('./modules/search/services/IndexService');

const TENANT_ID = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

async function rebuild() {
    try {
        console.log('Rebuilding search index to include created_by in metadata...');
        const indexService = new IndexService();
        const result = await indexService.rebuildIndex(TENANT_ID);
        console.log(`Done. Indexed ${result.indexedCount} items.`);
    } catch (e) {
        console.error('Rebuild failed:', e.message);
    } finally {
        process.exit(0);
    }
}
rebuild();
