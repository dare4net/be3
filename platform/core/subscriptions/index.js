/**
 * Subscriptions Module Bootstrapper
 * PRINCIPLE: All feature access is subscription-gated
 */

const express = require('express');
const SubscriptionPlan = require('./models/SubscriptionPlan');
const Subscription = require('./models/Subscription');
const { authenticate } = require('../auth/middleware/authenticate');
const { asyncHandler } = require('../../../middleware/errorHandler');
const eventBus = require('../../events/EventBus');

async function bootstrap(context) {
    const { app } = context;
    const router = express.Router();

    // Get all plans (public)
    router.get('/plans', asyncHandler(async (req, res) => {
        const plans = await SubscriptionPlan.findAll(true);
        res.json({ success: true, plans });
    }));

    // Subscribe to a plan
    router.post('/subscribe', authenticate, asyncHandler(async (req, res) => {
        const subscription = await Subscription.create(req.tenantId, req.body.planId);

        eventBus.emitEvent('subscription.created', {
            tenantId: req.tenantId,
            planId: req.body.planId,
        });

        res.status(201).json({ success: true, subscription });
    }));

    // Get current subscription
    router.get('/current', authenticate, asyncHandler(async (req, res) => {
        const subscription = await Subscription.findActive(req.tenantId);
        res.json({ success: true, subscription });
    }));

    // Cancel subscription
    router.post('/cancel', authenticate, asyncHandler(async (req, res) => {
        const subscription = await Subscription.cancel(req.tenantId);

        eventBus.emitEvent('subscription.cancelled', {
            tenantId: req.tenantId,
        });

        res.json({ success: true, subscription });
    }));

    app.use('/subscriptions', router);
    console.log('[Subscriptions] Routes registered at /subscriptions');

    return true;
}

module.exports = { bootstrap };
