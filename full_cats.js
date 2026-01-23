const { query } = require('./config/database');
query("SELECT id, name, parent_id FROM categories WHERE tenant_id = 'cbe1df05-45ed-455a-9ce6-156b0bd45713'")
    .then(r => console.log(JSON.stringify(r.rows, null, 2)))
    .catch(console.error)
    .finally(() => process.exit());
