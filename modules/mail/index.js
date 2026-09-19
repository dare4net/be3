/**
 * Mail Module
 *
 * Selects the active mail transport based on USE_RESEND_API env var:
 *   USE_RESEND_API=true  → ResendMailService (Resend HTTP API, no SMTP)
 *   USE_RESEND_API=false → MailService (nodemailer / SMTP)
 *
 * PRINCIPLE: Any module can be removed without crashing the system
 */

const useResend = process.env.USE_RESEND_API === 'true';
const MailService = useResend
    ? require('./services/ResendMailService')
    : require('./services/MailService');

console.log(`[MailModule] Transport: ${useResend ? 'Resend API' : 'SMTP/nodemailer'}`);

async function bootstrap(context) {
    const { eventBus } = context;

    console.log('[MailModule] Initializing...');

    // 1. Listen for User Registration
    eventBus.registerListener('user.registered', async (event) => {
        const { data } = event;
        try {
            console.log(`[MailModule] Handling user.registered for ${data.email}`);
            await MailService.sendVerificationEmail({
                email: data.email,
                token: data.emailVerificationToken,
                tenantId: data.tenantId,
                firstName: data.firstName || ''
            });
        } catch (error) {
            console.error('[MailModule] Failed to send verification email:', error.message);
        }
    }, 'MailModule');

    // 2. Listen for Password Reset Requests
    eventBus.registerListener('password.reset_requested', async (event) => {
        const { data } = event;
        try {
            console.log(`[MailModule] Handling password.reset_requested for ${data.email}`);
            await MailService.sendPasswordResetEmail({
                email: data.email,
                token: data.resetToken,
                tenantId: data.tenantId
            });
        } catch (error) {
            console.error('[MailModule] Failed to send password reset email:', error.message);
        }
    }, 'MailModule');

    console.log('✓ Mail module initialized');
}

module.exports = { bootstrap };
