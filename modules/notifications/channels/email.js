'use strict';

const { query } = require('../../../config/database');

const useResend = process.env.USE_RESEND_API === 'true';
const MailService = useResend
    ? require('../../mail/services/ResendMailService')
    : require('../../mail/services/MailService');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3003';

/* ── HTML template helpers ─────────────────────────────────── */
function wrap(content) {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:40px 20px;">
<div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
  <div style="background:#111827;padding:24px 32px;">
    <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">be3</span>
    <span style="color:#6b7280;font-size:13px;margin-left:8px;">Marketplace</span>
  </div>
  <div style="padding:32px;">${content}</div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #f3f4f6;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">© ${new Date().getFullYear()} Be3 Platform</p>
  </div>
</div>
</td></tr></table>
</body></html>`;
}

function btn(text, url, color = '#2563eb') {
    return `<div style="margin:28px 0;text-align:center;">
      <a href="${url}" style="background:${color};color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;display:inline-block;">${text}</a>
    </div>`;
}

/* ── Per-type templates ────────────────────────────────────── */
const TEMPLATES = {
    'order.created': ({ orderNumber, actionUrl }) => ({
        subject: `Order ${orderNumber} confirmed`,
        html: wrap(`<h2 style="margin-top:0;color:#111827;">Order Confirmed 🎉</h2>
          <p style="color:#374151;">Your order <strong>${orderNumber}</strong> has been placed successfully.</p>
          ${btn('View Order', actionUrl)}
          <p style="font-size:13px;color:#6b7280;">We'll notify you when it ships.</p>`),
        text: `Your order ${orderNumber} has been placed. View it here: ${actionUrl}`,
    }),

    'payment.success': ({ orderNumber, amount, currency, actionUrl }) => ({
        subject: `Payment confirmed — ${orderNumber}`,
        html: wrap(`<h2 style="margin-top:0;color:#111827;">Payment Received ✅</h2>
          <p style="color:#374151;">Your payment of <strong>${currency} ${Number(amount).toLocaleString()}</strong> for order <strong>${orderNumber}</strong> was successful.</p>
          ${btn('View Order', actionUrl, '#16a34a')}
          <p style="font-size:13px;color:#6b7280;">Thank you for shopping with us.</p>`),
        text: `Payment confirmed for order ${orderNumber}. Amount: ${currency} ${amount}. View: ${actionUrl}`,
    }),

    'payment.failed': ({ orderNumber, actionUrl }) => ({
        subject: `Payment failed — ${orderNumber}`,
        html: wrap(`<h2 style="margin-top:0;color:#111827;">Payment Failed ❌</h2>
          <p style="color:#374151;">We were unable to process your payment for order <strong>${orderNumber}</strong>.</p>
          ${btn('Retry Payment', actionUrl, '#dc2626')}
          <p style="font-size:13px;color:#6b7280;">Your card was not charged. Please try again.</p>`),
        text: `Payment failed for order ${orderNumber}. Retry here: ${actionUrl}`,
    }),

    'order.shipped': ({ orderNumber, actionUrl }) => ({
        subject: `Your order ${orderNumber} has shipped 🚚`,
        html: wrap(`<h2 style="margin-top:0;color:#111827;">Your Order is on its Way!</h2>
          <p style="color:#374151;">Order <strong>${orderNumber}</strong> has been shipped and is on its way to you.</p>
          ${btn('Track Order', actionUrl)}
          <p style="font-size:13px;color:#6b7280;">Delivery times may vary.</p>`),
        text: `Order ${orderNumber} has shipped. Track it here: ${actionUrl}`,
    }),

    'order.delivered': ({ orderNumber, actionUrl }) => ({
        subject: `Order ${orderNumber} delivered ✓`,
        html: wrap(`<h2 style="margin-top:0;color:#111827;">Order Delivered!</h2>
          <p style="color:#374151;">Your order <strong>${orderNumber}</strong> has been delivered. We hope you love it!</p>
          ${btn('Leave a Review', actionUrl, '#7c3aed')}
          <p style="font-size:13px;color:#6b7280;">Thank you for shopping with us.</p>`),
        text: `Order ${orderNumber} delivered. Leave a review: ${actionUrl}`,
    }),

    'order.cancelled': ({ orderNumber, actionUrl }) => ({
        subject: `Order ${orderNumber} cancelled`,
        html: wrap(`<h2 style="margin-top:0;color:#111827;">Order Cancelled</h2>
          <p style="color:#374151;">Order <strong>${orderNumber}</strong> has been cancelled. If this was unexpected, please contact support.</p>
          ${btn('View Orders', actionUrl, '#6b7280')}
          <p style="font-size:13px;color:#6b7280;">If you paid, a refund will be processed within 3–5 business days.</p>`),
        text: `Order ${orderNumber} cancelled. View orders: ${actionUrl}`,
    }),

    'admin.order.new': ({ orderNumber, actionUrl }) => ({
        subject: `New order received — ${orderNumber}`,
        html: wrap(`<h2 style="margin-top:0;color:#111827;">New Order 🛒</h2>
          <p style="color:#374151;">You have received a new order: <strong>${orderNumber}</strong>.</p>
          ${btn('View in Dashboard', actionUrl, '#111827')}
          <p style="font-size:13px;color:#6b7280;">Please process this order promptly.</p>`),
        text: `New order ${orderNumber} received. View it: ${actionUrl}`,
    }),
};

/* ── Delivery function ─────────────────────────────────────── */
async function deliver({ userId, type, title, message, actionUrl, templateData = {} }) {
    if (!userId) return;

    // Fetch email for this user
    const userRes = await query(`SELECT email FROM users WHERE id = $1`, [userId]);
    const email = userRes.rows[0]?.email;
    if (!email) return;

    const templateFn = TEMPLATES[type];
    const mailPayload = templateFn
        ? templateFn({ ...templateData, actionUrl, title })
        : { subject: title, html: wrap(`<p>${message || title}</p>${btn('View', actionUrl)}`), text: message || title };

    try {
        await MailService.sendMail({ to: email, ...mailPayload });
    } catch (err) {
        console.error(`[Notifications/Email] Failed to send ${type} to ${email}:`, err.message);
    }
}

module.exports = { deliver };
