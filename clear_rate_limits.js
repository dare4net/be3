const { createClient } = require('redis');
require('dotenv').config();

const client = createClient({
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
    },
    password: process.env.REDIS_PASSWORD || undefined,
    database: process.env.REDIS_DB || 0,
});

(async () => {
    try {
        await client.connect();

        // Scan for keys
        // We look for common rate limit prefixes.
        // Based on typical implementations: 'ratelimit:*', 'rl:*'
        // I'll check the file content first, but this is a starter.

        // Actually, I'll wait to read the file to know the exact prefix.
        // For now, I'll just list keys to be safe.
        const keys = await client.keys('*');
        console.log('Found keys:', keys.length);

        // Filter for rate limit keys (I will update this after reading the file)

    } catch (e) {
        console.error(e);
    } finally {
        await client.disconnect();
    }
})();
