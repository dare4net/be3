/**
 * Standalone Embedding Generation Script
 * 
 * Usage:
 *   node modules/vector/scripts/generateEmbeddings.js
 *   node modules/vector/scripts/generateEmbeddings.js --force    (re-embed everything)
 *   node modules/vector/scripts/generateEmbeddings.js --stats    (show stats only)
 * 
 * Prerequisites:
 *   1. Run migration 051_enable_pgvector.js first
 *   2. Transformer service must be running (cd be3-ai-transformer && npm start)
 *   3. TRANSFORMER_URL must be set in .env (default: http://localhost:3009)
 */

require('dotenv').config();
const VectorEngine = require('../services/VectorEngine');

const TENANT_ID = process.env.TENANT_ID;

async function main() {
    const engine = new VectorEngine();
    const args = process.argv.slice(2);
    const type = args.find(a => a.startsWith('--type='))?.split('=')[1] || 'text';
    const force = args.includes('--force');
    const statsOnly = args.includes('--stats');

    if (!TENANT_ID) {
        console.error('❌ TENANT_ID not set in .env');
        process.exit(1);
    }

    console.log(`\n🧠 Vector Embedding Generator`);
    console.log(`   Tenant: ${TENANT_ID}`);
    console.log(`   Type:   ${type.toUpperCase()}`);
    console.log(`   Model:  ${type === 'image' ? 'CLIP (512D)' : `${engine.modelName} (${engine.dimensions}D)`}`);
    console.log(`   Transformer: ${process.env.TRANSFORMER_URL || 'http://localhost:3009'}\n`);

    // Stats-only mode
    if (args.includes('--stats')) {
        const stats = await engine.getStats(TENANT_ID);
        console.log('📊 Current Stats:');
        console.log(`   Total products:    ${stats.total_products}`);
        console.log(`   Embedded:          ${stats.embedded_products}`);
        console.log(`   Coverage:          ${stats.coverage}`);
        console.log(`   Last embedded at:  ${stats.last_embedded_at || 'never'}`);

        const missing = await engine.getMissingEmbeddings(TENANT_ID, 10);
        if (missing.length > 0) {
            console.log(`\n   ⚠ Missing embeddings (showing first ${missing.length}):`);
            missing.forEach(p => console.log(`     - ${p.name} (${p.id})`));
        } else {
            console.log(`\n   ✅ All products have embeddings!`);
        }

        process.exit(0);
    }

    // Embedding mode
    if (force) {
        console.log('⚠ Force mode: all products will be re-embedded.\n');
    }

    try {
        const result = await engine.embedAllProducts(TENANT_ID, { force, type });

        console.log(`\n✅ Embedding complete:`);
        console.log(`   Total:    ${result.total}`);
        console.log(`   Embedded: ${result.embedded}`);
        console.log(`   Skipped:  ${result.skipped}`);
        console.log(`   Failed:   ${result.failed}`);
        console.log(`   Duration: ${result.duration}`);

        // Verify
        const verification = await engine.verifyEmbeddings(TENANT_ID);
        console.log(`\n🔍 Verification:`);
        console.log(`   Valid:   ${verification.valid}`);
        console.log(`   Invalid: ${verification.invalid}`);

    } catch (err) {
        console.error('❌ Embedding failed:', err.message);
        process.exit(1);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
