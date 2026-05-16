const client = require('./config/redis').redisClient;
require('dotenv').config();
async function run() {
  try {
      const keys = await client.keys('15m_*');
      if (keys.length > 0) {
          await client.del(keys);
          console.log('Deleted Redis keys:', keys.length);
      } else {
          console.log('No Redis keys found.');
      }
  } catch (e) { console.error(e); }
  process.exit(0);
}
run();
