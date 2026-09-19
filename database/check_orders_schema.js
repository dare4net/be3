const { query } = require('../config/database');

async function check() {
    const cols = await query(`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'orders'
        ORDER BY column_name
    `);
    console.log('\n=== orders columns ===');
    cols.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type}) default=${r.column_default}`));

    const constraints = await query(`
        SELECT conname, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conrelid = 'orders'::regclass
        ORDER BY conname
    `);
    console.log('\n=== orders constraints ===');
    constraints.rows.forEach(r => console.log(`  ${r.conname}: ${r.def}`));

    process.exit(0);
}

check().catch(e => { console.error(e.message); process.exit(1); });
