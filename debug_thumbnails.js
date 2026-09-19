const { query } = require('./config/database');

async function run() {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713'; // Active Tenant
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date().toISOString();

    const sql = `
        WITH event_counts AS (
            SELECT 
                entity_type, 
                entity_id, 
                COUNT(*) FILTER (WHERE event_type = 'impression') as impressions,
                COUNT(*) FILTER (WHERE event_type = 'page_view') as page_views,
                COUNT(*) FILTER (WHERE event_type = 'click') as clicks
            FROM analytics_events
            WHERE tenant_id = $1
              AND created_at >= $2::timestamp
              AND created_at <= $3::timestamp + INTERVAL '1 day'
            GROUP BY 1, 2
        ),
        metadata AS (
            SELECT 'product' as type, id::text as eid, name, image_url as thumbnail, created_by::text as owner_id FROM products WHERE tenant_id = $1
            UNION ALL
            SELECT 'category' as type, id::text as eid, name, NULL::text as thumbnail, NULL::text as owner_id FROM categories WHERE tenant_id = $1
            UNION ALL
            SELECT 'collection' as type, id::text as eid, name, NULL::text as thumbnail, created_by::text as owner_id FROM collections WHERE tenant_id = $1
            UNION ALL
            SELECT 'page' as type, id::text as eid, title as name, NULL::text as thumbnail, NULL::text as owner_id FROM pages WHERE tenant_id = $1
        ),
        combined_stats AS (
            SELECT 
                ec.entity_type,
                ec.entity_id,
                COALESCE(m.name, ec.entity_id) as entity_name,
                m.thumbnail,
                m.owner_id,
                ec.impressions,
                ec.page_views,
                ec.clicks,
                CASE 
                    WHEN ec.impressions > 0 THEN ROUND((ec.clicks::decimal / ec.impressions::decimal) * 100, 2)
                    ELSE 0 
                END as ctr
            FROM event_counts ec
            LEFT JOIN metadata m ON ec.entity_type = m.type AND ec.entity_id = m.eid
        ),
        ranked AS (
            SELECT *, RANK() OVER (PARTITION BY entity_type ORDER BY ctr DESC) as global_rank FROM combined_stats
        )
        SELECT entity_name, thumbnail, impressions FROM ranked 
        WHERE entity_type = 'product'
        ORDER BY impressions DESC
        LIMIT 5;
    `;

    try {
        const res = await query(sql, [tenantId, start, end]);
        console.log("Full CTE Result:", JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    }
}

run();
