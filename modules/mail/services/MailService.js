/**
 * Mail Service
 * 
 * Handles sending emails using Nodemailer.
 * PRINCIPLE: Fails gracefully - if SMTP is not configured, it logs to console.
 */

const nodemailer = require('nodemailer');

class MailService {
    constructor() {
        this.transporter = null;
        this.from = process.env.MAIL_FROM || 'BE3 Platform <noreply@be3.shop>';
        this.initialize();
    }

    /**
     * Initialize Nodemailer transporter
     */
    initialize() {
        const host = process.env.SMTP_HOST;
        const port = process.env.SMTP_PORT;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;

        if (host && port && user && pass) {
            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === '465', // true for 465, false for other ports
                auth: {
                    user,
                    pass,
                },
            });
            console.log('✓ MailService: SMTP transporter initialized');
        } else {
            console.log('⚠ MailService: SMTP credentials missing. Emails will be logged to console.');
        }
    }

    /**
     * Send generic email
     */
    async sendMail(options) {
        const mailOptions = {
            from: this.from,
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
        };

        if (this.transporter) {
            try {
                const info = await this.transporter.sendMail(mailOptions);
                console.log(`[Mail] Email sent to ${options.to}: ${info.messageId}`);
                return info;
            } catch (error) {
                console.error(`[Mail] Failed to send email to ${options.to}:`, error.message);
                throw error;
            }
        } else {
            // Development fallback: Log to console
            console.log('\n========================================');
            console.log('       DEVELOPMENT EMAIL PREVIEW');
            console.log('========================================');
            console.log(`To:      ${options.to}`);
            console.log(`Subject: ${options.subject}`);
            console.log(`Text:    ${options.text}`);
            console.log('========================================\n');
            return { messageId: 'dev-log-id' };
        }
    }

    /**
     * Send Verification Email
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
     * Send Password Reset Email
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

module.exports = new MailService();
