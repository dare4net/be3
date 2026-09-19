const RandomizationService = require('../modules/search/services/RandomizationService');
const { pool } = require('../config/database');

async function verify() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    const attributeCode = 'j';
    const clause = {
        name: 'test_clause',
        value: 200,
        operator: '<'
    };

    console.log('Testing getEligibleCategoriesForClause with numeric operator and potential empty strings...');
    try {
        const results = await RandomizationService.getEligibleCategoriesForClause(tenantId, attributeCode, clause);
        console.log(`Success! Found ${results.length} eligible categories.`);
        process.exit(0);
    } catch (err) {
        console.error('Verification FAILED:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

verify();
