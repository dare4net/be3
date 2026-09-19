/**
 * Live Resend Test Script
 * 
 * Usage: node test-resend-live.js your-email@example.com
 */

require('dotenv').config();
const MailService = require('./modules/mail/services/MailService');

const targetEmail = process.argv[2];

if (!targetEmail) {
    console.error('❌ Error: Please provide a target email address.');
    console.log('Usage: node test-resend-live.js your-email@example.com');
    process.exit(1);
}

async function testLiveEmail() {
    console.log(`\n🚀 Attempting to send a live test email to: ${targetEmail}`);
    console.log(`Using From: ${process.env.MAIL_FROM || 'Not set'}`);
    console.log(`Using Host: ${process.env.SMTP_HOST || 'Not set'}\n`);

    try {
        const info = await MailService.sendMail({
            to: targetEmail,
            subject: 'BE3 Platform - Resend Test Email 🚀',
            text: 'If you are reading this, your Resend configuration on updates.be3.shop is working perfectly!',
            html: `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px;">
                    <h2 style="color: #2563eb;">It Works! 🚀</h2>
                    <p>This is a test email from your <strong>BE3 Platform</strong>.</p>
                    <p>Your Resend integration with the subdomain <code>updates.be3.shop</code> is now live and functional.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #666;">Sent at: ${new Date().toLocaleString()}</p>
                </div>
            `
        });

        console.log('\n✅ SUCCESS!');
        console.log(`Message ID: ${info.messageId}`);
        console.log('Check your inbox (and your spam folder just in case)!');

    } catch (error) {
        console.error('\n❌ FAILED to send email:');
        console.error(error.message);
        
        if (error.message.includes('550')) {
            console.log('\n💡 TIP: A 550 error usually means Resend hasn\'t authorized this "From" address yet. Make sure updates.be3.shop is verified in your Resend Dashboard.');
        }
    } finally {
        process.exit(0);
    }
}

testLiveEmail();
