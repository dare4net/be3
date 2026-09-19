const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'saas_ecommerce',
    password: process.env.DB_PASSWORD || '343434',
    port: 5432,
});

async function checkAttributes() {
    try {
        const res = await pool.query('SELECT code, clauses FROM attributes WHERE clauses IS NOT NULL AND jsonb_array_length(clauses) > 0');
        res.rows.forEach(row => {
            console.log('--- ATTR:', row.code, '---');
            console.log(JSON.stringify(row.clauses, null, 2));
        });
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkAttributes();
