const { query } = require('../config/database');

async function check() {
    try {
        console.log("Checking pages table unique constraints...");
        const res = await query(`
            SELECT 
                conname as constraint_name,
                pg_get_constraintdef(c.oid) as definition
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE contype = 'u' 
              AND conrelid = 'pages'::regclass;
        `);
        console.log(JSON.stringify(res.rows, null, 2));

        console.log("\nChecking pages for a specific tenant (the one we saw earlier)...");
        const pages = await query("SELECT slug, is_system, is_published FROM pages WHERE tenant_id = 'cbe1df05-45ed-455a-9ce6-156b0bd45713'");
        console.log(JSON.stringify(pages.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

check();
