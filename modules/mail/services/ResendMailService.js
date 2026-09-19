/**
 * ResendMailService
 *
 * Sends email via the Resend REST API (https://resend.com/docs/api-reference/emails/send-email).
 * Drop-in replacement for MailService — exposes the same public methods.
 *
 * Required env vars:
 *   RESEND_API_KEY   — your Resend API key  (re_xxxx)
 *   MAIL_FROM        — sender address        ("BE3 Platform <noreply@updates.be3.shop>")
 *
 * Toggle:
 *   USE_RESEND_API=true  → this service is used
 *   USE_RESEND_API=false → falls back to MailService (nodemailer / SMTP)
 */

const https = require('https');

const RESEND_API_URL = 'https://api.resend.com/emails';

class ResendMailService {
    constructor() {
        this.apiKey = process.env.RESEND_API_KEY;
        this.from   = process.env.MAIL_FROM || 'BE3 Platform <noreply@updates.be3.shop>';

        if (this.apiKey) {
            console.log('✓ ResendMailService: Resend API transport initialized');
        } else {
            console.warn('⚠ ResendMailService: RESEND_API_KEY missing — emails will be logged to console only');
        }
    }

    /**
     * Send a raw HTTP POST to the Resend /emails endpoint.
     * @param {object} payload  — { from, to, subject, html, text }
     */
    _callResendApi(payload) {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify(payload);
            const options = {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            };

            const req = https.request(RESEND_API_URL, options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            reject(new Error(`Resend API error ${res.statusCode}: ${JSON.stringify(parsed)}`));
                        }
                    } catch (e) {
                        reject(new Error(`Resend API parse error: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Send generic email — mirrors MailService.sendMail() signature.
     * @param {{ to, subject, text, html }} options
     */
    async sendMail(options) {
        if (!this.apiKey) {
            // Dev fallback: log to console
            console.log('\n========================================');
            console.log('       DEVELOPMENT EMAIL PREVIEW (Resend)');
            console.log('========================================');
            console.log(`To:      ${options.to}`);
            console.log(`Subject: ${options.subject}`);
            console.log(`Text:    ${options.text}`);
            console.log('========================================\n');
            return { id: 'dev-resend-preview' };
        }

        try {
            const result = await this._callResendApi({
                from: this.from,
                to: Array.isArray(options.to) ? options.to : [options.to],
                subject: options.subject,
                html: options.html,
                text: options.text,
            });
            console.log(`[ResendMail] Email sent to ${options.to}: id=${result.id}`);
            return result;
        } catch (error) {
            console.error(`[ResendMail] Failed to send email to ${options.to}:`, error.message);
            throw error;
        }
    }

    /**
     * Send Verification Email — mirrors MailService.sendVerificationEmail()
     */
    async sendVerificationEmail(data) {
        const { email, token, tenantId, firstName } = data;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const verificationLink = `${frontendUrl}/auth/verify?token=${token}&tenantId=${tenantId}`;

        const subject = 'Verify your account';
        const text = `Hi ${firstName || 'there'},\n\nPlease verify your account by clicking this link: ${verificationLink}`;
        const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e1e1e1; border-radius: 8px; padding: 20px;">
                <h2 style="color: #2563eb;">Welcome to BE3!</h2>
                <p>Hi ${firstName || 'there'},</p>
                <p>Thank you for signing up. Please verify your email address to get started.</p>
                <div style="margin: 30px 0; text-align: center;">
                    <a href="${verificationLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Verify My Account</a>
                </div>
                <p style="font-size: 14px; color: #666;">If the button doesn't work, copy and paste this link into your browser:</p>
                <p style="font-size: 12px; color: #3b82f6;">${verificationLink}</p>
                <hr style="border: 0; border-top: 1px solid #e1e1e1; margin: 20px 0;">
                <p style="font-size: 12px; color: #999; text-align: center;">© 2026 BE3 Platform. Multi-tenant eCommerce.</p>
            </div>
        `;

        return this.sendMail({ to: email, subject, text, html });
    }

    /**
     * Send Password Reset Email — mirrors MailService.sendPasswordResetEmail()
     */
    async sendPasswordResetEmail(data) {
        const { email, token, tenantId } = data;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const resetLink = `${frontendUrl}/auth/reset-password?token=${token}&tenantId=${tenantId}`;

        const subject = 'Reset your password';
        const text = `You requested a password reset. Please use this link: ${resetLink}\n\nThis link will expire in 1 hour.`;
        const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e1e1e1; border-radius: 8px; padding: 20px;">
                <h2 style="color: #2563eb;">Password Reset Requested</h2>
                <p>We received a request to reset your password.</p>
                <div style="margin: 30px 0; text-align: center;">
                    <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
                </div>
                <p style="font-size: 14px; color: #666;">This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.</p>
                <hr style="border: 0; border-top: 1px solid #e1e1e1; margin: 20px 0;">
                <p style="font-size: 12px; color: #999; text-align: center;">© 2026 BE3 Platform. Multi-tenant eCommerce.</p>
            </div>
        `;

        return this.sendMail({ to: email, subject, text, html });
    }
}

module.exports = new ResendMailService();
