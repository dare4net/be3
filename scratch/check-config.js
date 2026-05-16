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
      const res = await client.query("SELECT config FROM page_widgets WHERE tenant_id = '" + t + "' AND widget_type = 'category_grid'");
      if(res.rows.length){
          res.rows.forEach((r, i) => {
             console.log('Widget ' + i + ' config:', JSON.stringify(r.config, null, 2));
          });
      } else {
          console.log('No category grid widgets found.');
      }
  } catch (e) { console.error(e); }
  await client.end();
  process.exit(0);
}
run();
