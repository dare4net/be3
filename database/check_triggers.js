const { query } = require('../config/database');
async function check() {
    const triggers = await query(`
        SELECT trigger_name, event_manipulation, action_timing, action_statement
        FROM information_schema.triggers
        WHERE event_object_table = 'orders'
    `);
    console.log('\n=== orders triggers ===');
    if (triggers.rows.length === 0) console.log('  (none)');
    triggers.rows.forEach(r => console.log(`  ${r.trigger_name} — ${r.action_timing} ${r.event_manipulation}: ${r.action_statement}`));

    // Also check if there's a payment_status constraint on payments table
    const constraints = await query(`
        SELECT conname, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conrelid = 'payments'::regclass
        ORDER BY conname
    `);
    console.log('\n=== payments constraints ===');
    constraints.rows.forEach(r => console.log(`  ${r.conname}: ${r.def}`));

    process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });
