const { query } = require('./config/database');

async function check() {
    try {
        const result = await query("SELECT tablename, policyname, permissive, roles, cmd, qual FROM pg_policies WHERE tablename = 'collections'");
        console.log('--- Collection Policies ---');
        console.log(JSON.stringify(result.rows, null, 2));

        const rlsCheck = await query("SELECT relname, relrowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE relname = 'collections' AND nspname = 'public'");
        console.log('--- RLS Status ---');
        console.log(JSON.stringify(rlsCheck.rows, null, 2));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

check();
