const { query } = require('./config/database');

async function check() {
    try {
        const result = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'collections'");
        console.log('--- Collection Columns ---');
        result.rows.forEach(r => console.log(`- ${r.column_name}`));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

check();
