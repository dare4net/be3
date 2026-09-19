const pg = require('pg');
const fs = require('fs');
require('dotenv').config({ path: './be3-WA/.env' });

const db = new pg.Pool({
    connectionString: `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`
});

async function inspect() {
    try {
        const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
        const res = await db.query("SELECT code, label, type, options, clauses FROM public.attributes WHERE tenant_id = $1", [tenantId]);

        fs.writeFileSync('select_attributes_dump.json', JSON.stringify(res.rows, null, 2));
        console.log(`✅ Dumped ${res.rows.length} select attributes to select_attributes_dump.json`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

inspect();
