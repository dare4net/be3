const { pool } = require('./config/database');

async function inspect() {
    try {
        const res = await pool.query(`
            SELECT conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE conrelid = 'category_attributes'::regclass
        `);
        console.log('Constraints on category_attributes:', res.rows);
    } catch (err) {
        console.error('Error inspecting:', err);
    } finally {
        process.exit();
    }
}

inspect();
