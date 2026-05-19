/**
 * Invoices Module
 *
 * On-demand PDF invoice/receipt generation using pdfkit.
 * No DB storage — PDFs are streamed directly to the client.
 *
 * Routes:
 *   GET  /invoices/orders/:orderId          — download invoice PDF
 *   GET  /invoices/orders/:orderId/receipt  — download receipt PDF (post-payment)
 *   POST /invoices/orders/:orderId/send     — email invoice to customer
 */

const express = require('express');
const PDFDocument = require('pdfkit');
const { query } = require('../../config/database');
const { authenticate, optionalAuth } = require('../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../middleware/errorHandler');

// ── Currency formatter ────────────────────────────────────────────────────────
function fmt(amount, currency = 'NGN') {
    const num = parseFloat(amount || 0);
    try {
        return new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(num);
    } catch {
        return `${currency} ${num.toFixed(2)}`;
    }
}

// ── Fetch order + items + tenant info ─────────────────────────────────────────
async function fetchOrderData(orderId, tenantId) {
    const orderRes = await query(
        `SELECT o.*, t.name as store_name, t.settings as tenant_settings
         FROM orders o
         JOIN tenants t ON t.id = o.tenant_id
         WHERE (o.id::text = $1 OR o.order_number = $1) AND o.tenant_id = $2`,
        [orderId, tenantId]
    );
    if (!orderRes.rows[0]) return null;

    const order = orderRes.rows[0];
    const itemsRes = await query(
        `SELECT oi.*, p.image_url FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1`,
        [order.id]
    );
    order.items = itemsRes.rows;
    return order;
}

// ── Build PDF document ────────────────────────────────────────────────────────
function buildPDF(order, type = 'invoice') {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const isReceipt = type === 'receipt';

    const meta = order.metadata || {};
    const settings = order.tenant_settings || {};
    const storeName = order.store_name || 'Store';
    const currency = settings.currency || 'NGN';
    const logoUrl = settings.logo_url;

    // ── Colors ────────────────────────────────────────────────────────────
    const BLUE = '#1a56e8';
    const DARK = '#111827';
    const MUTED = '#6b7280';
    const LIGHT_BG = '#f9fafb';
    const BORDER = '#e5e7eb';

    const pageWidth = doc.page.width - 100; // accounting for margins

    // ── Header bar ────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 120).fill(BLUE);

    // Store name
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22)
        .text(storeName, 50, 35);

    doc.font('Helvetica').fontSize(11).fillColor('#ffffffcc')
        .text(isReceipt ? 'PAYMENT RECEIPT' : 'INVOICE', 50, 62);

    // Invoice number (right aligned)
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
        .text(`#${order.order_number}`, 50, 35, { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#ffffffcc')
        .text(`Date: ${new Date(order.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`, 50, 55, { align: 'right' });

    // ── Status badge ──────────────────────────────────────────────────────
    const statusColors = { paid: '#16a34a', fulfilled: '#16a34a', unpaid: '#dc2626', pending: '#d97706', processing: '#2563eb' };
    const badgeColor = statusColors[order.payment_status] || '#6b7280';
    doc.roundedRect(doc.page.width - 150, 80, 100, 24, 4).fill(badgeColor);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
        .text((order.payment_status || 'UNPAID').toUpperCase(), doc.page.width - 148, 88, { width: 96, align: 'center' });

    let y = 145;

    // ── Billing / Customer info ────────────────────────────────────────────
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text('BILLED TO', 50, y);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    const customerName = meta.customer_name || order.billing_address?.name || 'Customer';
    const customerEmail = meta.customer_email || '';
    const customerPhone = meta.customer_phone || '';
    doc.fillColor(DARK).font('Helvetica').fontSize(10)
        .text(customerName, 50, y + 16)
        .text(customerEmail, 50, y + 30)
        .text(customerPhone, 50, y + 44);

    // Shipping address (right side)
    if (meta.shipping_address || order.shipping_address) {
        const addr = meta.shipping_address || order.shipping_address;
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text('SHIP TO', 300, y);
        doc.font('Helvetica').fontSize(10).fillColor(DARK);
        const addrStr = typeof addr === 'string' ? addr : `${addr.line1 || ''}, ${addr.city || ''}, ${addr.state || ''}`;
        doc.text(addrStr, 300, y + 16, { width: 200 });
    }

    y += 90;

    // ── Items table header ────────────────────────────────────────────────
    doc.rect(50, y, pageWidth, 28).fill(LIGHT_BG);
    doc.rect(50, y, pageWidth, 28).stroke(BORDER);

    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9);
    doc.text('ITEM', 60, y + 9);
    doc.text('QTY', 370, y + 9);
    doc.text('UNIT PRICE', 420, y + 9);
    doc.text('TOTAL', 510, y + 9);

    y += 28;

    // ── Items ─────────────────────────────────────────────────────────────
    for (const item of order.items || []) {
        const rowHeight = 36;
        doc.rect(50, y, pageWidth, rowHeight).stroke(BORDER);

        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
            .text(item.product_name || 'Product', 60, y + 8, { width: 300 });
        if (item.variant_label) {
            doc.font('Helvetica').fontSize(8).fillColor(MUTED)
                .text(item.variant_label, 60, y + 22);
        }

        doc.font('Helvetica').fontSize(10).fillColor(DARK)
            .text(String(item.quantity), 370, y + 13)
            .text(fmt(item.price, currency), 420, y + 13)
            .text(fmt(item.total || item.price * item.quantity, currency), 510, y + 13);

        y += rowHeight;

        // Page break guard
        if (y > doc.page.height - 200) {
            doc.addPage();
            y = 50;
        }
    }

    y += 20;

    // ── Totals ────────────────────────────────────────────────────────────
    const totalsX = 380;
    const totalsWidth = pageWidth - 330;

    const row = (label, value, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
            .fillColor(bold ? DARK : MUTED)
            .text(label, totalsX, y, { width: 100 })
            .text(value, totalsX + 110, y, { width: 100, align: 'right' });
        y += 20;
    };

    row('Subtotal', fmt(order.subtotal || order.total, currency));
    if (parseFloat(order.discount_amount) > 0) {
        row('Discount', `- ${fmt(order.discount_amount, currency)}`);
    }
    if (parseFloat(order.shipping_cost || 0) > 0) {
        row('Shipping', fmt(order.shipping_cost, currency));
    }
    if (parseFloat(order.tax_amount || 0) > 0) {
        row('Tax', fmt(order.tax_amount, currency));
    }

    // Total line
    y += 4;
    doc.moveTo(totalsX, y).lineTo(totalsX + 210, y).stroke(BORDER);
    y += 8;
    row('TOTAL', fmt(order.total, currency), true);

    // ── Payment info ──────────────────────────────────────────────────────
    if (isReceipt && order.payment_method) {
        y += 10;
        doc.rect(50, y, pageWidth, 40).fill(LIGHT_BG).stroke(BORDER);
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9)
            .text('PAYMENT METHOD', 60, y + 8);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED)
            .text((order.payment_method || '').replace(/_/g, ' ').toUpperCase(), 60, y + 20);
        y += 55;
    }

    // ── Notes ─────────────────────────────────────────────────────────────
    if (order.notes) {
        y += 10;
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9).text('NOTES', 50, y);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(order.notes, 50, y + 14, { width: pageWidth });
        y += 40;
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc.rect(0, footerY - 10, doc.page.width, 70).fill(LIGHT_BG);
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(`Thank you for shopping with ${storeName}. For support, reply to this ${isReceipt ? 'receipt' : 'invoice'}.`,
            50, footerY, { align: 'center', width: pageWidth });

    return doc;
}

// ── Module bootstrap ──────────────────────────────────────────────────────────
async function bootstrap(context) {
    const { app } = context;

    try {
        const router = express.Router();

        // GET /invoices/orders/:orderId — invoice PDF
        router.get('/orders/:orderId', optionalAuth, asyncHandler(async (req, res) => {
            const order = await fetchOrderData(req.params.orderId, req.tenantId);
            if (!order) return res.status(404).json({ error: 'Order not found' });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="invoice-${order.order_number}.pdf"`);

            const doc = buildPDF(order, 'invoice');
            doc.pipe(res);
            doc.end();
        }));

        // GET /invoices/orders/:orderId/receipt — receipt PDF
        router.get('/orders/:orderId/receipt', optionalAuth, asyncHandler(async (req, res) => {
            const order = await fetchOrderData(req.params.orderId, req.tenantId);
            if (!order) return res.status(404).json({ error: 'Order not found' });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="receipt-${order.order_number}.pdf"`);

            const doc = buildPDF(order, 'receipt');
            doc.pipe(res);
            doc.end();
        }));

        // POST /invoices/orders/:orderId/send — email invoice to customer
        router.post('/orders/:orderId/send', authenticate, asyncHandler(async (req, res) => {
            const order = await fetchOrderData(req.params.orderId, req.tenantId);
            if (!order) return res.status(404).json({ error: 'Order not found' });

            const recipientEmail = req.body.email
                || order.metadata?.customer_email
                || order.billing_address?.email;

            if (!recipientEmail) {
                return res.status(400).json({ error: 'No customer email found on this order' });
            }

            // Generate PDF buffer
            const doc = buildPDF(order, 'invoice');
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));

            await new Promise((resolve, reject) => {
                doc.on('end', resolve);
                doc.on('error', reject);
                doc.end();
            });

            const pdfBuffer = Buffer.concat(chunks);

            // Send via mail module (event-based)
            try {
                const MailService = require('../mail/MailService');
                await MailService.send({
                    tenantId: req.tenantId,
                    to: recipientEmail,
                    subject: `Invoice #${order.order_number} from ${order.store_name}`,
                    html: `<p>Hi ${order.metadata?.customer_name || 'Customer'},</p>
                           <p>Please find your invoice for order <strong>#${order.order_number}</strong> attached.</p>
                           <p>Total: <strong>${fmt(order.total)}</strong></p>`,
                    attachments: [{
                        filename: `invoice-${order.order_number}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf',
                    }],
                });
            } catch (e) {
                console.warn('[Invoices] Mail send failed (non-fatal):', e.message);
                return res.status(500).json({ error: 'Failed to send email', detail: e.message });
            }

            res.json({ success: true, message: `Invoice sent to ${recipientEmail}` });
        }));

        app.use('/invoices', router);
        console.log('[Invoices] Module initialized');
        return true;

    } catch (error) {
        console.error('[Invoices] Bootstrap failed:', error);
        return false;
    }
}

module.exports = { bootstrap };
