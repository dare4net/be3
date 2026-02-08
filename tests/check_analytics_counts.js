const { query } = require('./config/database');

async function checkCounts() {
    try {
        const res = await query(`
            SELECT event_type, entity_type, COUNT(*) 
            FROM analytics_events 
            GROUP BY 1, 2
            ORDER BY 3 DESC
        `);
        console.table(res.rows);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkCounts();
