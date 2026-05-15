'use strict';

/**
 * Channel matrix — defines default delivery channels per notification type.
 * inapp: always stored as a DB row + socket.io push
 * email: sent via mail module with dedicated HTML template
 * fcm:   sent via Firebase Cloud Messaging (browser + PWA push)
 */
const TYPES = {
    // ── Customer-facing ──────────────────────────────────────────────
    'order.created':         { inapp: true,  email: true,  fcm: false, target: 'customer' },
    'order.whatsapp.created':{ inapp: true,  email: false, fcm: false, target: 'customer' },
    'payment.success':       { inapp: true,  email: true,  fcm: true,  target: 'customer' },
    'payment.failed':        { inapp: true,  email: true,  fcm: true,  target: 'customer' },
    'order.shipped':         { inapp: true,  email: true,  fcm: true,  target: 'customer' },
    'order.delivered':       { inapp: true,  email: true,  fcm: true,  target: 'customer' },
    'order.cancelled':       { inapp: true,  email: true,  fcm: true,  target: 'customer' },
    'chat.message':          { inapp: true,  email: false, fcm: true,  target: 'both'     },

    // ── Admin/Vendor-facing ───────────────────────────────────────────
    'admin.order.new':       { inapp: true,  email: true,  fcm: true,  target: 'admin'    },
    'admin.order.whatsapp':  { inapp: true,  email: false, fcm: true,  target: 'admin'    },
    'admin.payment.received':{ inapp: true,  email: false, fcm: true,  target: 'admin'    },
    'admin.chat.message':    { inapp: true,  email: false, fcm: true,  target: 'admin'    },

    // ── System ────────────────────────────────────────────────────────
    'system.verified':       { inapp: true,  email: true,  fcm: false, target: 'customer' },
};

module.exports = TYPES;
