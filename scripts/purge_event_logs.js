require('dotenv').config();
const { query } = require('../config/database');

async function purgeLogs() {
    try {
        console.log("Starting purge operation on event_logs...");

        // Delete any event starting with 'analytics.'
        const sql = `DELETE FROM event_logs WHERE event_name LIKE 'analytics.%';`;

        const result = await query(sql);
        console.log(`✅ Successfully purged ${result.rowCount} contaminated tracking records from the event_logs table.`);

    } catch (e) {
        console.error("\n[Error purging logs]:", e.message);
    } finally {
        process.exit();
    }
}

purgeLogs();
