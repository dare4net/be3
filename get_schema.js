const { query } = require('./config/database');
query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'categories'")
    .then(r => console.log(JSON.stringify(r.rows, null, 2)))
    .catch(console.error)
    .finally(() => process.exit());
