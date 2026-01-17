const { query, pool } = require('./config/database');

async function checkConstraints() {
    try {
        const res = await query(`
            SELECT conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE conrelid = 'carts'::regclass
        `);
        console.log('Constraints on carts table:', res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkConstraints();
