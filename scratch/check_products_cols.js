const { query } = require('../config/database');
query("SELECT column_name FROM information_schema.columns WHERE table_name = 'products' ORDER BY ordinal_position")
  .then(res => console.log(res.rows.map(r => r.column_name)))
  .catch(console.error)
  .finally(() => process.exit());
