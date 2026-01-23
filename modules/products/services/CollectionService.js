/**
 * Collection Service
 * Handles rule-based product collections and manual overrides
 */

const { query } = require('../../../config/database');

class CollectionService {
    /**
     * Build SQL fragment for a collection's rules
     * @param {Array} rules - Array of rule objects
     * @param {Array} queryParams - Array to push values into
     * @param {number} startIndex - Current param index
     * @returns {Object} - { sql, nextIndex }
     */
    buildRulesSQL(rules, queryParams, startIndex) {
        if (!rules || !Array.isArray(rules) || rules.length === 0) {
            return { sql: 'TRUE', nextIndex: startIndex };
        }

        let index = startIndex;
        const conditions = rules.map(rule => {
            const { field, operator, value } = rule;

            // Logic for different fields
            switch (field) {
                case 'category':
                    // value is expected to be an array of category IDs
                    queryParams.push(value);
                    const catSQL = `si.metadata->'category_ids' ?| $${index}`;
                    index++;
                    return catSQL;

                case 'tag':
                    // value is expected to be a tag string or array
                    if (Array.isArray(value)) {
                        queryParams.push(value);
                        const tagSQL = `si.metadata->'tags' ?| $${index}`;
                        index++;
                        return tagSQL;
                    } else {
                        queryParams.push(value);
                        const tagSQL = `si.metadata->'tags' ? $${index}`;
                        index++;
                        return tagSQL;
                    }

                case 'attribute':
                    // value is expected to be "attr_code:value" or "attr_code:clause_name"
                    const [attrCode, attrVal] = value.split(':');
                    queryParams.push(attrCode, attrVal);
                    const attrSQL = `si.metadata->'attributes'->>$${index} = $${index + 1}`;
                    index += 2;
                    return attrSQL;

                case 'price':
                    // operator could be 'gt', 'lt', 'between'
                    const numVal = parseFloat(value);
                    if (operator === 'gt') {
                        queryParams.push(numVal);
                        const sql = `(si.metadata->>'price')::numeric > $${index}`;
                        index++;
                        return sql;
                    } else if (operator === 'lt') {
                        queryParams.push(numVal);
                        const sql = `(si.metadata->>'price')::numeric < $${index}`;
                        index++;
                        return sql;
                    }
                    return 'TRUE';

                default:
                    return 'TRUE';
            }
        });

        return {
            sql: conditions.join(' AND '),
            nextIndex: index
        };
    }

    /**
     * Get products in a collection
     * @param {string} tenantId 
     * @param {string} collectionId 
     * @param {Object} options - { page, perPage, sort }
     */
    async getCollectionProducts(tenantId, collectionId, options = {}) {
        const { page = 1, perPage = 20, sort = 'relevance' } = options;
        const offset = (page - 1) * perPage;

        // 1. Fetch collection details
        const collectionRes = await query(
            `SELECT * FROM collections WHERE id = $1 AND tenant_id = $2`,
            [collectionId, tenantId]
        );

        if (!collectionRes.rows[0]) throw new Error('Collection not found');
        const collection = collectionRes.rows[0];

        // 2. Build Rule SQL
        const queryParams = [tenantId];
        const { sql: rulesSQL, nextIndex } = this.buildRulesSQL(collection.rules, queryParams, 2);

        // 3. Handle Manual Overrides
        const manualInclusions = (collection.manual_product_ids || []).map(id => `'${id}'`).join(',');
        const manualExclusions = (collection.excluded_product_ids || []).map(id => `'${id}'`).join(',');

        let finalSQL = `
            SELECT si.* 
            FROM search_indexes si
            WHERE si.tenant_id = $1 
            AND si.content_type = 'product'
            AND si.is_active = true
            AND (
                (${rulesSQL})
                ${manualInclusions.length > 0 ? `OR si.content_id IN (${manualInclusions})` : ''}
            )
            ${manualExclusions.length > 0 ? `AND si.content_id NOT IN (${manualExclusions})` : ''}
        `;

        // 4. Add Sorting and Pagination
        // (Simplified sorting for now, reusing SearchService logic would be better)
        finalSQL += ` ORDER BY si.created_at DESC LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`;
        queryParams.push(perPage, offset);

        const result = await query(finalSQL, queryParams);

        // 5. Total count for pagination
        let countSQL = `
            SELECT COUNT(*) 
            FROM search_indexes si
            WHERE si.tenant_id = $1 
            AND si.content_type = 'product'
            AND si.is_active = true
            AND (
                (${rulesSQL})
                ${manualInclusions.length > 0 ? `OR si.content_id IN (${manualInclusions})` : ''}
            )
            ${manualExclusions.length > 0 ? `AND si.content_id NOT IN (${manualExclusions})` : ''}
        `;
        const countRes = await query(countSQL, queryParams.slice(0, nextIndex - 1));

        return {
            products: result.rows,
            total: parseInt(countRes.rows[0].count),
            collection
        };
    }
}

module.exports = new CollectionService();
