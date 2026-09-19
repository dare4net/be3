const { pool } = require('../config/database');
require('dotenv').config();

async function verifyProductionData() {
    const url = process.env.DATABASE_URL;
    console.log('🔍 Database Verification...');
    console.log(`Connecting to: ${url ? 'Remote (DATABASE_URL found)' : 'Local (No DATABASE_URL)'}\n`);

    try {
        // 1. Check Tenants
        const tenantRes = await pool.query('SELECT name, subdomain, status FROM tenants');
        console.log('--- Registered Tenants ---');
        if (tenantRes.rows.length === 0) {
            console.warn('⚠️ No tenants found in database!');
        } else {
            tenantRes.rows.forEach(t => {
                console.log(`- [${t.status}] ${t.name} (${t.subdomain})`);
            });
        }
        console.log('\n--- Configuration Check ---');
        console.log(`TARGET_SUBDOMAIN: ${process.env.NEXT_PUBLIC_SUBDOMAIN || 'demo'}`);

        const target = process.env.NEXT_PUBLIC_SUBDOMAIN || 'demo';
        const match = tenantRes.rows.find(t => t.subdomain === target);

        if (match) {
            console.log(`✅ SUCCESS: Subdomain "${target}" exists in the DB.`);
        } else {
            console.error(`❌ ERROR: Subdomain "${target}" NOT FOUND in the DB.`);
            console.warn('   Make sure you ran the data migration command from the Deployment Guide.');
        }

    } catch (err) {
        console.error('💥 Database Error:', err.message);
    } finally {
        await pool.end();
    }
}

verifyProductionData();
