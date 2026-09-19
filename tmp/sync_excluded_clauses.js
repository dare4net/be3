const { query, pool } = require('../config/database');

async function syncExcludedClauses() {
    try {
        console.log("Starting sync of excluded_clauses to category_attributes...");

        // 1. Fetch all attributes that have clauses
        const attrsRes = await query(`
            SELECT id, tenant_id, clauses 
            FROM attributes 
            WHERE clauses IS NOT NULL AND jsonb_array_length(clauses) > 0
        `);

        console.log(`Found ${attrsRes.rows.length} attributes with clauses.`);

        let syncedCount = 0;

        for (const attr of attrsRes.rows) {
            const clauses = attr.clauses;
            const tenantId = attr.tenant_id;
            const attributeId = attr.id;

            // Build map of categoryId -> array of excluded clause names
            const catExclusions = {};

            for (const clause of clauses) {
                if (clause.excluded_category_ids && Array.isArray(clause.excluded_category_ids)) {
                    for (const catId of clause.excluded_category_ids) {
                        if (!catExclusions[catId]) {
                            catExclusions[catId] = [];
                        }
                        if (clause.name) {
                            catExclusions[catId].push(clause.name);
                        }
                    }
                }
            }

            // First, clear existing excluded_clauses for this attribute
            await query(
                `UPDATE category_attributes SET excluded_clauses = '[]'::jsonb WHERE attribute_id = $1 AND tenant_id = $2`,
                [attributeId, tenantId]
            );

            // Now upsert the newly mapped exclusions
            for (const [catId, excludedClauseNames] of Object.entries(catExclusions)) {
                if (excludedClauseNames.length === 0) continue;

                // We must handle cases where category_id might not exist in categories table (data corruption protection)
                const catExists = await query(`SELECT id FROM categories WHERE id = $1 AND tenant_id = $2`, [catId, tenantId]);
                if (catExists.rows.length === 0) continue;

                const excludedJson = JSON.stringify(excludedClauseNames);

                await query(
                    `INSERT INTO category_attributes (tenant_id, category_id, attribute_id, excluded_clauses)
                     VALUES ($1, $2, $3, $4::jsonb)
                     ON CONFLICT (category_id, attribute_id) 
                     DO UPDATE SET excluded_clauses = EXCLUDED.excluded_clauses`,
                    [tenantId, catId, attributeId, excludedJson]
                );
                syncedCount++;
            }
        }

        console.log(`Sync complete! Upserted exclusions for ${syncedCount} category-attribute pairs.`);
    } catch (e) {
        console.error("Error during sync:", e);
    } finally {
        pool.end();
    }
}

syncExcludedClauses();
