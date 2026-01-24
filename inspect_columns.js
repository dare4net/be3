const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'saas_ecommerce',
    password: process.env.DB_PASSWORD || '343434',
    port: 5432,
});

async function checkColumns() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'attributes'");
        console.log('Attributes Table Columns:', res.rows.map(r => r.column_name));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkColumns();
