/**
 * Main Server Entry Point
 * 
 * PRINCIPLE: Core runs even with zero feature modules installed
 * PRINCIPLE: Any module can be removed without crashing the system
 * PRINCIPLE: Modules do not import other modules
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

const { pool } = require('./config/database');
const eventBus = require('./platform/events/EventBus');
const eventLogger = require('./platform/events/EventLogger');
const tenantIdentifier = require('./middleware/tenantIsolation');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { createTenantRateLimiter } = require('./middleware/rateLimiter');
const moduleBootstrapper = require('./utils/moduleBootstrapper');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Initialize Application
 */
async function initializeApp() {
    console.log('\n========================================');
    console.log('  Multi-Tenant SaaS eCommerce Platform');
    console.log('========================================\n');

    // Test database connection
    try {
        await pool.query('SELECT NOW()');
        console.log('✓ Database connection established');
    } catch (error) {
        console.error('✗ Database connection failed:', error.message);
        process.exit(1);
    }

    // Initialize event logger
    await eventLogger.initialize();

    // Global middleware
    app.use(helmet()); // Security headers
    app.use(cors()); // CORS
    app.use(compression()); // Response compression
    app.use(morgan('combined')); // Logging
    app.use(express.json()); // JSON body parser
    app.use(express.urlencoded({ extended: true })); // URL-encoded body parser

    // Tenant identification first (so rate limiter can use req.tenantId for per-tenant keys and exempt check)
    // PRINCIPLE: Multi-tenant by default
    app.use(tenantIdentifier);

    // Rate limiting (after tenantId is set so keys are per-tenant and we can skip exempt tenants)
    app.use(createTenantRateLimiter());

    // Health check endpoint (no tenant required)
    app.get('/health', (req, res) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            loadedModules: moduleBootstrapper.getLoadedModules(),
        });
    });

    // Root endpoint
    app.get('/', (req, res) => {
        res.json({
            message: 'Multi-Tenant SaaS eCommerce Platform API',
            version: '1.0.0',
            documentation: '/api/docs',
        });
    });

    // Initialize event bus module
    const eventsModule = require('./platform/events/index');
    await eventsModule.bootstrap();

    // Load core platform modules
    // PRINCIPLE: Core runs even with zero feature modules installed
    console.log('\n--- Loading Core Modules ---');
    await moduleBootstrapper.loadCoreModules(app, eventBus);

    // Load feature modules
    // PRINCIPLE: Any module can be removed without crashing the system
    console.log('\n--- Loading Feature Modules ---');
    await moduleBootstrapper.loadFeatureModules(app, eventBus);

    // 404 handler
    app.use(notFoundHandler);

    // Global error handler
    app.use(errorHandler);

    console.log('\n✓ Application initialized successfully');
    console.log(`✓ Loaded modules: ${moduleBootstrapper.getLoadedModules().join(', ')}`);
}

/**
 * Start Server
 */
async function startServer() {
    try {
        await initializeApp();

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n========================================`);
            console.log(`  Server running on port ${PORT}`);
            console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`========================================\n`);
        });
    } catch (error) {
        console.error('\n✗ Failed to start server:', error);
        process.exit(1);
    }
}

// Handle uncaught errors
let lastRejection = null;
process.on('unhandledRejection', (error) => {
    // ANTI-SPAM: Don't flood the console with the same rejection (e.g. from Redis loop)
    const msg = error.message || String(error);
    if (msg === lastRejection) return;

    console.error('🕒 Unhandled Rejection (Recovering):', msg);
    lastRejection = msg;
    // Reset after 10 seconds to allow showing if it happens again later
    setTimeout(() => { if (lastRejection === msg) lastRejection = null; }, 10000);
});

process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error.message || error);
    // Uncaught exceptions are usually more severe code issues, so we exit but with a slight delay 
    // to allow logging to flush. In a production cluster (PM2/Kubernetes), it will restart.
    setTimeout(() => process.exit(1), 500);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('\nSIGTERM received, shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

// Start the server
// initializeApp().then(() => { ... }) is not used here as startServer calls it.
startServer();

module.exports = app;
