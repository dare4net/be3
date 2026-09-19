require('dotenv').config();
const { query } = require('../config/database');

async function peekEventLogs() {
    try {
        const sql = `
            SELECT 
                id, 
                tenant_id, 
                event_name, 
                user_id, 
                payload, 
                created_at 
            FROM event_logs 
            ORDER BY created_at DESC 
            LIMIT 5
        `; // Assuming some common columns, but we'll fetch everything if it fails

        let result;
        try {
            result = await query(sql);
        } catch (e) {
            result = await query(`SELECT * FROM event_logs ORDER BY created_at DESC LIMIT 5`);
        }

        console.log("\n=== RECENT 5 EVENT LOGS ===");
        console.log(JSON.stringify(result.rows, null, 2));

    } catch (e) {
        console.error("\n[Error fetching event logs]:", e.message);
    } finally {
        process.exit();
    }
}

peekEventLogs();
