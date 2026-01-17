/**
 * Marketing Module
 * Handles newsletter subscriptions and marketing features
 */

const express = require('express');
const NewsletterSubscriber = require('./models/NewsletterSubscriber');
const { authenticate } = require('../../platform/core/auth/middleware/authenticate');
const authorize = require('../../platform/core/roles/middleware/authorize');
const { asyncHandler } = require('../../middleware/errorHandler');

async function bootstrap(context) {
    const { app } = context;
    const router = express.Router();

    // Subscribe to newsletter (PUBLIC)
    router.post('/newsletter/subscribe', asyncHandler(async (req, res) => {
        const { email } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Valid email required' });
        }

        const subscriber = await NewsletterSubscriber.create(req.tenantId, email);
        res.json({ success: true, message: 'Successfully subscribed!', subscriber });
    }));

    // Get all subscribers (ADMIN)
    router.get('/newsletter/subscribers', authenticate, authorize('products.manage'), asyncHandler(async (req, res) => {
        const subscribers = await NewsletterSubscriber.findAll(req.tenantId);
        res.json({ success: true, subscribers });
    }));

    // Unsubscribe (PUBLIC with token, or admin)
    router.post('/newsletter/unsubscribe', asyncHandler(async (req, res) => {
        const { email } = req.body;
        const subscriber = await NewsletterSubscriber.unsubscribe(req.tenantId, email);
        res.json({ success: true, message: 'Successfully unsubscribed', subscriber });
    }));

    app.use('/marketing', router);
    console.log('[Marketing] Module initialized');

    return true;
}

module.exports = { bootstrap };
