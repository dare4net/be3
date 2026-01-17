const { createClient } = require('redis');
require('dotenv').config();

const redisClient = createClient({
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
    },
});

(async () => {
    await redisClient.connect();
    console.log('Clearing ALL Redis keys...');
    await redisClient.flushAll();
    console.log('Redis cleared.');
    process.exit(0);
})();
