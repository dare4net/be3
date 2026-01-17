const eventBus = require('./platform/events/EventBus');
const eventLogger = require('./platform/events/EventLogger');
const { pool } = require('./config/database');

async function testLogging() {
    console.log('Testing Event Logger...');
    await eventLogger.initialize();

    console.log('Emitting test event...');

    // This should trigger the console.log we added
    eventBus.emitEvent('test.event', {
        tenantId: 'system-test',
        message: 'Hello World'
    });

    // Give it a moment to process
    setTimeout(async () => {
        console.log('Test complete. Did you see "[Event] test.event" above?');
        await pool.end();
    }, 1000);
}

testLogging();
