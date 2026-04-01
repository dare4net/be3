const { query, pool } = require('../config/database');

async function fixDataLeak() {
    try {
        await query(`UPDATE system_attributes SET options = '[]' WHERE code = 'vendor'`);
        console.log("Successfully wiped tenant-specific vendor names from the global system_attributes table.");
    } catch (e) {
        console.error("Error protecting db:", e);
    } finally {
        pool.end();
    }
}

fixDataLeak();
