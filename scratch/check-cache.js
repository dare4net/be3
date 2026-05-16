const { Client } = require('pg');
require('dotenv').config();
async function run() {
  const t = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
  const client = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
  });
  await client.connect();
  try {
      await client.query("DELETE FROM randomization_snapshots WHERE tenant_id = '" + t + "';");
      console.log('SQL snapshots deleted.');
      const res = await client.query("SELECT page_data FROM pages WHERE tenant_id = '" + t + "' AND handle = 'home';");
      if(res.rows.length){
         const data = typeof res.rows[0].page_data === 'string' ? JSON.parse(res.rows[0].page_data) : res.rows[0].page_data;
         const grid = data.layout.find(w => w.type === 'category_grid');
         console.log('Category Grid Config:', JSON.stringify(grid?.config, null, 2));
      }
  } catch (e) { console.error(e); }
  await client.end();
  process.exit(0);
}
run();
