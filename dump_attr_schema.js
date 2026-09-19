const { query } = require('./config/database');

async function checkSchema() {
    try {
        const attrRes = await query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'attributes'`);
        console.log('--- Attributes Table ---');
        console.table(attrRes.rows);

        const clausesRes = await query(`SELECT clauses FROM attributes LIMIT 5`);
        console.log('--- Sample Clauses JSON ---');
        clausesRes.rows.forEach(r => console.log(JSON.stringify(r.clauses, null, 2)));

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

checkSchema();
