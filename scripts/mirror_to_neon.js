require('dotenv').config();
const { spawn } = require('child_process');

/**
 * Mirror Local to Neon
 * version 5: Atomic (Single Transaction) + Error Handling
 */

const localDb = process.env.DB_NAME || 'saas_ecommerce';
const localUser = process.env.DB_USER || 'postgres';
const localPass = process.env.DB_PASSWORD || '';
const remoteUrl = process.env.DATABASE_URL;

if (!remoteUrl) {
    console.error('\n❌ ERROR: No uncommented DATABASE_URL found in .env');
    process.exit(1);
}

console.log(`\n🚀 STARTING ATOMIC DATABASE MIRROR`);
console.log(`==================================================`);
console.log(`📡 SOURCE: ${localDb}`);
console.log(`🌐 TARGET: Neon Remote`);
console.log(`🛡️  MODE  : Single Transaction (All-or-nothing)`);
console.log(`==================================================\n`);

const processEnv = { ...process.env, PGPASSWORD: localPass };

/**
 * pg_dump | psql
 * -1 / --single-transaction: Ensures that if the network drops, 
 *    the entire migration rolls back on Neon, leaving it clean.
 */
const dumpCmd = `pg_dump -v -U ${localUser} --no-owner --no-privileges ${localDb}`;
const restoreCmd = `psql -v ON_ERROR_STOP=1 --single-transaction --dbname="${remoteUrl}"`;

console.log('🔄 Mirroring... If this fails, Neon will automatically roll back to its previous state.\n');

const sync = spawn(`${dumpCmd} | ${restoreCmd}`, { shell: true, env: processEnv });

sync.stderr.on('data', (data) => process.stdout.write(data.toString()));
sync.stdout.on('data', (data) => process.stdout.write(data.toString()));

sync.on('close', (code) => {
    if (code === 0) {
        console.log('\n✅ SUCCESS: Mirroring complete.');
    } else {
        console.error(`\n❌ FAILED: Exit code ${code}`);
        console.error('Because we used --single-transaction, your Neon DB has been rolled back and is still clean.');
        console.error('Try running the script again once your connection is stable.');
    }
    process.exit(code);
});
