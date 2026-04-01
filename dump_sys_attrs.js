const { query } = require('./config/database');

async function dumpSystemAttributes() {
    try {
        const result = await query('SELECT * FROM system_attributes');
        console.log(JSON.stringify(result.rows, null, 2));
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

dumpSystemAttributes();
