/**
 * Filter SQL Builder
 * Builds complex WHERE clause SQL for search filters including:
 * - Collection rules with recursive category resolution
 * - Price ranges, categories, status, tags
 * - Custom attribute filters with clause support
 * - Natural language query (NLQ) patterns
 */

const { query } = require('../../../../config/database');

class FilterSQLBuilder {
    constructor(categoryResolver) {
        this.categoryResolver = categoryResolver;
    }

    /**
     * Build filter SQL
     * @param {string} tenantId
     * @param {Object} filters
     * @param {Array} queryParams
     * @param {number} startIndex
     * @returns {Object} - { sql, nextIndex }
     */
    async buildFilterSQL(tenantId, filters, queryParams, startIndex) {
        let sql = '';
        let index = startIndex;

        // Collection Rules and Overrides
        if (filters.collection_rules || filters.collection_manual_in || filters.collection_manual_ex) {
            let colSQL = ' (';
            let hasRules = false;

            if (filters.collection_rules && Array.isArray(filters.collection_rules) && filters.collection_rules.length > 0) {
                const ruleConditions = [];
                for (const rule of filters.collection_rules) {
                    const { field, operator, value } = rule;
                    switch (field) {
                        case 'category':
                            const catIds = Array.isArray(value) ? value : [value];
                            if (catIds.length > 0) {
                                const resolvedCatIds = [];
                                for (const id of catIds) {
                                    const descendants = await this.categoryResolver.getDescendantCategoryIds(tenantId, id);
                                    resolvedCatIds.push(...descendants);
                                }
                                ruleConditions.push(`si.metadata->'category_ids' ?| $${index}`);
                                queryParams.push([...new Set(resolvedCatIds)]);
                                index++;
                            }
                            break;
                        case 'tag':
                            if (Array.isArray(value)) {
                                ruleConditions.push(`si.metadata->'tags' ?| $${index}`);
                            } else {
                                ruleConditions.push(`si.metadata->'tags' ? $${index}`);
                            }
                            queryParams.push(value);
                            index++;
                            break;
                        case 'price':
                            const priceVal = `si.metadata->>'price'`;
                            const safePrice = `(CASE WHEN ${priceVal} ~ '^-?[0-9.]+$' THEN (${priceVal})::numeric ELSE NULL END)`;
                            if (operator === 'gt') {
                                ruleConditions.push(`${safePrice} > $${index}`);
                            } else if (operator === 'lt') {
                                ruleConditions.push(`${safePrice} < $${index}`);
                            }
                            queryParams.push(parseFloat(value));
                            index++;
                            break;
                        case 'has_attribute':
                            ruleConditions.push(`si.metadata->'attributes' ? $${index}`);
                            queryParams.push(value);
                            index++;
                            break;
                        case 'attribute':
                            let attrCode, attrVal;
                            if (rule.attribute_code) {
                                attrCode = rule.attribute_code;
                                attrVal = rule.value;
                            } else {
                                [attrCode, attrVal] = String(value).split(':');
                            }
                            if (attrCode && attrVal !== undefined) {
                                if (Array.isArray(attrVal)) {
                                    ruleConditions.push(`si.metadata->'attributes'->>$${index} = ANY($${index + 1})`);
                                } else {
                                    ruleConditions.push(`si.metadata->'attributes'->>$${index} = $${index + 1}`);
                                }
                                queryParams.push(attrCode, attrVal);
                                index += 2;
                            }
                            break;
                        case 'attribute_clause':
                            const acattrCode = rule.attribute_code;
                            const clauseName = value;
                            if (acattrCode && clauseName) {
                                const attrRes = await query(
                                    `SELECT clauses, type FROM attributes WHERE tenant_id = $1 AND code = $2`,
                                    [tenantId, acattrCode]
                                );
                                if (attrRes.rows[0]) {
                                    const { clauses, type } = attrRes.rows[0];
                                    const clause = (clauses || []).find(c => c.name === clauseName);
                                    if (clause) {
                                        let op = clause.operator || '=';
                                        const ruleVal = clause.value;
                                        const isArray = Array.isArray(ruleVal);

                                        if (isArray && (op === '=' || op === 'LIKE' || op === 'ILIKE')) {
                                            op = (op === 'LIKE' || op === 'ILIKE') ? 'ILIKE ANY' : '= ANY';
                                        }

                                        if (type === 'number') {
                                            const attrVal = `si.metadata->'attributes'->>$${index}`;
                                            const safeAttr = `(CASE WHEN ${attrVal} ~ '^-?[0-9.]+$' THEN (${attrVal})::numeric ELSE NULL END)`;
                                            ruleConditions.push(`${safeAttr} ${op} (${isArray ? `$${index + 1}::numeric[]` : `$${index + 1}`})`);
                                        } else {
                                            ruleConditions.push(`si.metadata->'attributes'->>$${index} ${op} ($${index + 1})`);
                                        }
                                        queryParams.push(acattrCode, ruleVal);
                                        index += 2;
                                    }
                                }
                            }
                            break;
                    }
                }
                if (ruleConditions.length > 0) {
                    colSQL += `(${ruleConditions.join(' AND ')})`;
                    hasRules = true;
                }
            }

            if (filters.collection_manual_in && Array.isArray(filters.collection_manual_in) && filters.collection_manual_in.length > 0) {
                if (hasRules) colSQL += ' OR ';
                colSQL += `si.content_id = ANY($${index})`;
                queryParams.push(filters.collection_manual_in);
                index++;
                hasRules = true;
            }

            if (!hasRules) colSQL += ' TRUE';
            colSQL += ') ';

            if (filters.collection_manual_ex && Array.isArray(filters.collection_manual_ex) && filters.collection_manual_ex.length > 0) {
                colSQL += ` AND si.content_id != ALL($${index})`;
                queryParams.push(filters.collection_manual_ex);
                index++;
            }

            sql += ` AND ${colSQL}`;
        }

        // Price range filter
        if (filters.price_min !== undefined && filters.price_min !== null) {
            sql += ` AND (si.metadata->>'price')::numeric >= $${index}`;
            queryParams.push(parseFloat(filters.price_min));
            index++;
        }

        if (filters.price_max !== undefined && filters.price_max !== null) {
            sql += ` AND (si.metadata->>'price')::numeric <= $${index}`;
            queryParams.push(parseFloat(filters.price_max));
            index++;
        }

        // Category filter
        if (filters.category_id) {
            sql += ` AND si.metadata->'category_ids' ? $${index}`;
            queryParams.push(filters.category_id);
            index++;
        }

        if (filters.category_ids && Array.isArray(filters.category_ids)) {
            sql += ` AND si.metadata->'category_ids' ?| $${index}`;
            queryParams.push(filters.category_ids);
            index++;
        }

        // Status filter
        if (filters.status) {
            sql += ` AND si.metadata->>'status' = $${index}`;
            queryParams.push(filters.status);
            index++;
        }

        // Featured filter
        if (filters.is_featured !== undefined) {
            sql += ` AND (si.metadata->>'is_featured')::boolean = $${index}`;
            queryParams.push(filters.is_featured);
            index++;
        }

        // Tag filter
        if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
            sql += ` AND si.metadata->'tags' ?| $${index}`;
            queryParams.push(filters.tags);
            index++;
        } else if (filters.tag) {
            sql += ` AND si.metadata->'tags' ? $${index}`;
            queryParams.push(filters.tag);
            index++;
        }

        // Custom attribute filters (e.g., attribute.color, attribute.size, attribute.price:budget_deal)
        const attributeKeys = Object.keys(filters).filter(k => k.startsWith('attribute.'));

        if (attributeKeys.length > 0) {
            for (const key of attributeKeys) {
                const parts = key.replace('attribute.', '').split(':');
                const attrCode = parts[0];
                const clauseName = parts[1];
                const filterValue = filters[key];

                if (clauseName) {
                    const attrRes = await query(
                        `SELECT clauses, type FROM attributes WHERE tenant_id = $1 AND code = $2`,
                        [tenantId, attrCode]
                    );

                    if (attrRes.rows[0]) {
                        const { type } = attrRes.rows[0];
                        const clauses = (typeof attrRes.rows[0].clauses === 'string'
                            ? JSON.parse(attrRes.rows[0].clauses)
                            : attrRes.rows[0].clauses) || [];
                        const clause = clauses.find(c => c.name === clauseName);

                        if (clause) {
                            const op = clause.operator || '=';
                            const rawVal = clause.value || filterValue;

                            // Support array values (multi-select/multi-match)
                            const isArray = Array.isArray(rawVal) || (typeof rawVal === 'string' && rawVal.includes(','));
                            const val = Array.isArray(rawVal) ? rawVal : (typeof rawVal === 'string' && rawVal.includes(',') ? rawVal.split(',').map(v => v.trim()) : rawVal);

                            if (isArray && (op === '=' || op === 'LIKE' || op === 'ILIKE')) {
                                const finalOp = (op === 'LIKE' || op === 'ILIKE') ? 'ILIKE ANY' : '= ANY';
                                if (type === 'number') {
                                    sql += ` AND (si.metadata->'attributes'->>$${index})::numeric ${finalOp}($${index + 1}::numeric[])`;
                                } else {
                                    sql += ` AND si.metadata->'attributes'->>$${index} ${finalOp}($${index + 1})`;
                                }
                                queryParams.push(attrCode, val);
                                index += 2;
                            } else if (type === 'number') {
                                // Handle single numeric value
                                sql += ` AND (si.metadata->'attributes'->>$${index})::numeric ${op} $${index + 1}::numeric`;
                                queryParams.push(attrCode, val);
                                index += 2;
                            } else {
                                // Default text comparison
                                sql += ` AND si.metadata->'attributes'->>$${index} ${op} $${index + 1}`;
                                queryParams.push(attrCode, val);
                                index += 2;
                            }
                            continue;
                        }

                        // Handle NLQ patterns (e.g., _nlq_under_1000)
                        if (clauseName.startsWith('_nlq_')) {
                            const nlqParts = clauseName.split('_');
                            const opWord = nlqParts[2];
                            const val = nlqParts[3];
                            const opPhrases = { 'under': '<', 'below': '<', 'over': '>', 'above': '>', 'exactly': '=', 'min': '>=', 'max': '<=' };
                            const op = opPhrases[opWord] || '=';

                            if (type === 'number') {
                                sql += ` AND (si.metadata->'attributes'->>$${index})::numeric ${op} $${index + 1}::numeric`;
                                queryParams.push(attrCode, val);
                                index += 2;
                            } else {
                                sql += ` AND si.metadata->'attributes'->>$${index} ${op} $${index + 1}`;
                                queryParams.push(attrCode, val);
                                index += 2;
                            }
                            continue;
                        }
                    }
                    // If a clause was specified but not found in the defined clauses,
                    // treat the clauseName as the literal value to match (fallback/default)
                    const val = clauseName;
                    sql += ` AND si.metadata->'attributes'->>$${index} = $${index + 1}`;
                    queryParams.push(attrCode, val);
                    index += 2;
                    continue;
                }

                // Default: Exact match (only if no :clause was specified)
                const isArray = Array.isArray(filterValue) || (typeof filterValue === 'string' && filterValue.includes(','));
                const val = Array.isArray(filterValue) ? filterValue : (typeof filterValue === 'string' && filterValue.includes(',') ? filterValue.split(',').map(v => v.trim()) : filterValue);

                if (isArray) {
                    sql += ` AND si.metadata->'attributes'->>$${index} = ANY($${index + 1})`;
                } else {
                    sql += ` AND si.metadata->'attributes'->>$${index} = $${index + 1}`;
                }
                queryParams.push(attrCode, val);
                index += 2;
            }
        }

        return { sql, nextIndex: index };
    }
}

module.exports = FilterSQLBuilder;
