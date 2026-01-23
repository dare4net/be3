const { query } = require('./config/database');

async function auditIndexes() {
    try {
        const sql = `
            SELECT 
                t.relname as tablename,
                i.relname as indexname,
                a.attname as columnname,
                ix.indisunique as is_unique
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE t.relname IN ('attributes', 'category_attributes', 'search_indexes', 'categories')
            ORDER BY t.relname, i.relname;
        `;
        const res = await query(sql);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Audit failed:', err);
    } finally {
        process.exit();
    }
}

auditIndexes();
