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
      const res = await client.query("SELECT plan_data FROM randomization_snapshots WHERE tenant_id = '" + t + "' AND page_handle = 'home' ORDER BY created_at DESC LIMIT 1");
      if(res.rows.length){
          const plan = typeof res.rows[0].plan_data === 'string' ? JSON.parse(res.rows[0].plan_data) : res.rows[0].plan_data;
          console.log('Keys in plan:', Object.keys(plan));
          for(const k of Object.keys(plan)) {
              if (plan[k].multiple) {
                 console.log(k, 'selections count:', plan[k].selections.length);
              } else {
                 console.log(k, 'single selection');
              }
          }
      } else {
          console.log('No snapshots found in DB.');
      }
  } catch (e) { console.error(e); }
  await client.end();
  process.exit(0);
}
run();
