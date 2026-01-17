const eventLogger = require('./EventLogger');

/**
 * Events Module Bootstrapper
 * Initializes the event system
 */
async function bootstrap() {
    try {
        // Initialize event logger
        await eventLogger.initialize();

        console.log('✓ Events module initialized');
        return true;
    } catch (error) {
        console.error('✗ Events module failed to initialize:', error);
        // PRINCIPLE: Core runs even with zero feature modules installed
        // Event logging failure shouldn't crash the system
        return false;
    }
}

module.exports = { bootstrap };
