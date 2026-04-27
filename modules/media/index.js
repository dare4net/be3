const express = require('express');
const { registerMediaRoutes } = require('./routes/media.routes');

async function bootstrap(context) {
    const { app } = context;

    try {
        const router = express.Router();

        // Register the media routes
        registerMediaRoutes(router);

        // Mount the router at /media
        app.use('/media', router);
        
        return true;
    } catch (error) {
        console.error('[Media] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
