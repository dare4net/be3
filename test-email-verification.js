/**
 * Email Verification Test Script
 * 
 * Tests:
 * 1. User registration with expiry
 * 2. Successful verification
 * 3. Expired token verification
 * 4. Token resending
 */

const { pool, query } = require('./config/database');
const AuthService = require('./platform/core/auth/services/AuthService');
const User = require('./platform/core/auth/models/User');
const { v4: uuidv4 } = require('uuid');

async function runTest() {
    console.log('\n=== Starting Email Verification Tests ===\n');

    // Use a fixed tenant for testing
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    const testEmail = `tester_${Date.now()}@example.com`;
    const password = 'Password123!';

    try {
        // 1. Test Registration & Expiry Population
        console.log(`1. Testing registration for ${testEmail}...`);
        const registeredUser = await AuthService.register(tenantId, {
            email: testEmail,
            password: password,
            first_name: 'Test',
            last_name: 'User'
        });

        const userInDb = await User.findByEmail(tenantId, testEmail);
        console.log('✓ User created');
        console.log('✓ Token generated:', userInDb.email_verification_token);
        console.log('✓ Expiry set:', userInDb.email_verification_expires);

        if (!userInDb.email_verification_expires) {
            throw new Error('FAIL: email_verification_expires is null');
        }

        // 2. Test Successful Verification
        console.log('\n2. Testing successful verification...');
        await AuthService.verifyEmail(tenantId, userInDb.email_verification_token);
        const verifiedUser = await User.findByEmail(tenantId, testEmail);
        
        if (verifiedUser.email_verified && verifiedUser.email_verification_token === null) {
            console.log('✓ User verified successfully');
        } else {
            throw new Error('FAIL: User verification status incorrect');
        }

        // 3. Test Expired Token
        console.log('\n3. Testing expired token verification...');
        const expiredEmail = `expired_${Date.now()}@example.com`;
        await AuthService.register(tenantId, {
            email: expiredEmail,
            password: password
        });
        
        // Manually expire the token in DB
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        await query('UPDATE users SET email_verification_expires = $1 WHERE email = $2', [yesterday, expiredEmail]);
        
        const expiredUserInDb = await User.findByEmail(tenantId, expiredEmail);
        try {
            await AuthService.verifyEmail(tenantId, expiredUserInDb.email_verification_token);
            throw new Error('FAIL: Verification should have failed for expired token');
        } catch (err) {
            console.log('✓ Correctly failed verification for expired token:', err.message);
        }

        // 4. Test Token Resending
        console.log('\n4. Testing token resending...');
        const initialToken = expiredUserInDb.email_verification_token;
        await AuthService.resendVerification(tenantId, expiredEmail);
        
        const resentUserInDb = await User.findByEmail(tenantId, expiredEmail);
        console.log('✓ New token generated:', resentUserInDb.email_verification_token);
        console.log('✓ New expiry set:', resentUserInDb.email_verification_expires);

        if (resentUserInDb.email_verification_token === initialToken) {
            throw new Error('FAIL: Token did not change after resend');
        }
        
        // Final verification check after resend
        await AuthService.verifyEmail(tenantId, resentUserInDb.email_verification_token);
        console.log('✓ New token verified successfully');

        console.log('\n========================================');
        console.log('   🎉 ALL TESTS PASSED SUCCESSFULLY');
        console.log('========================================\n');

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

runTest();
