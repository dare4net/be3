require('dotenv').config();
const RandomizationService = require('../modules/search/services/RandomizationService');

async function debugPools() {
    try {
        const tenantId = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
        console.log(`Debugging Randomization Pools for tenant: ${tenantId}`);

        // Extracting fresh pools (no context, no excluded categories)
        const result = await RandomizationService.getFreshPools(tenantId, null, new Set());

        console.log("\n==================== POOL SUMMARY ====================");
        console.log(`Categories:  ${result.categories ? result.categories.length : 0}`);
        console.log(`Collections: ${result.collections ? result.collections.length : 0}`);
        console.log(`Clauses:     ${result.clauses ? result.clauses.length : 0}`);
        console.log("========================================================\n");

        if (result.categories && result.categories.length) {
            console.log("\n--- CATEGORIES POOL ---");
            console.log(JSON.stringify(result.categories.map(c => ({
                id: c.id,
                name: c.name,
                slug: c.slug,
                parent_id: c.parent_id
            })), null, 2));
        } else {
            console.log("No categories found in pool.");
        }

        if (result.collections && result.collections.length) {
            console.log("\n--- COLLECTIONS POOL ---");
            console.log(JSON.stringify(result.collections.map(c => ({
                id: c.id,
                name: c.name,
                slug: c.slug
            })), null, 2));
        }

        if (result.clauses && result.clauses.length) {
            console.log("\n--- CLAUSES POOL ---");
            console.log(JSON.stringify(result.clauses.map(c => ({
                attr_code: c.attribute.code,
                attr_label: c.attribute.label,
                clause_name: c.clause.name,
                clause_value: Array.isArray(c.clause.value) ? c.clause.value.join(', ') : c.clause.value
            })), null, 2));
        }

    } catch (e) {
        console.error("\n[Error debugging pools]:", e.message);
        console.error(e.stack);
    } finally {
        process.exit();
    }
}

debugPools();
