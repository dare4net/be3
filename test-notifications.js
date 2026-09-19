/**
 * Notification System — E2E Test Script
 *
 * Tests:
 *   1. Authentication (login → get token)
 *   2. REST API: unread-count, list, mark-read, mark-all-read
 *   3. In-app delivery: fire test notification → verify in DB via API
 *   4. Real-time: open socket → join user room → fire test notification → receive live event
 *
 * Usage:
 *   node test-notifications.js
 *   node test-notifications.js --email=user@store.com --password=pass123
 *
 * Requirements: backend must be running at BACKEND_URL
 */

const { io } = require('socket.io-client');

// ── Config ────────────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const TENANT_ID   = process.env.TENANT_ID   || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

// Parse CLI args
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => a.slice(2).split('='))
);

const EMAIL    = args.email    || process.env.TEST_EMAIL    || 'demo@be3.shop';
const PASSWORD = args.password || process.env.TEST_PASSWORD || 'password123';

// ── Helpers ───────────────────────────────────────────────────
let token, userId;
let passed = 0, failed = 0;

const RESET = '\x1b[0m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', BOLD = '\x1b[1m', CYAN = '\x1b[36m';

function log(msg)   { console.log(`  ${msg}`); }
function ok(msg)    { console.log(`  ${GREEN}✓${RESET} ${msg}`); passed++; }
function fail(msg)  { console.log(`  ${RED}✗${RESET} ${msg}`); failed++; }
function section(t) { console.log(`\n${BOLD}${CYAN}── ${t} ──${RESET}`); }

async function apiFetch(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'X-Tenant-ID': TENANT_ID,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
    };
    const res = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

// ── Test 1: Authentication ────────────────────────────────────
async function testAuth() {
    section('1. Authentication');
    const { status, body } = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });

    if (status === 200 && body.token) {
        token  = body.token;
        userId = body.user?.id;
        ok(`Login succeeded → userId=${userId}`);
    } else {
        fail(`Login failed: HTTP ${status} — ${JSON.stringify(body)}`);
        log(`${YELLOW}Hint: Check EMAIL/PASSWORD or run with --email=... --password=...${RESET}`);
        process.exit(1);
    }
}

// ── Test 2: REST API endpoints ────────────────────────────────
async function testRestAPI() {
    section('2. REST API');

    // Unread count
    const { status: s1, body: b1 } = await apiFetch('/notifications/unread-count');
    if (s1 === 200 && typeof b1.count === 'number') {
        ok(`GET /notifications/unread-count → ${b1.count} unread`);
    } else {
        fail(`GET /notifications/unread-count → HTTP ${s1}: ${JSON.stringify(b1)}`);
    }

    // List
    const { status: s2, body: b2 } = await apiFetch('/notifications');
    if (s2 === 200 && Array.isArray(b2.data)) {
        ok(`GET /notifications → ${b2.data.length} notification(s) returned`);
    } else {
        fail(`GET /notifications → HTTP ${s2}: ${JSON.stringify(b2)}`);
    }

    // Preferences
    const { status: s3, body: b3 } = await apiFetch('/notifications/preferences');
    if (s3 === 200) {
        ok(`GET /notifications/preferences → ${(b3.preferences || []).length} preference(s)`);
    } else {
        fail(`GET /notifications/preferences → HTTP ${s3}`);
    }
}

// ── Test 3: In-app delivery ───────────────────────────────────
async function testInAppDelivery() {
    section('3. In-app Delivery (fires notification via /notifications/test)');

    // Record count before
    const { body: before } = await apiFetch('/notifications/unread-count');
    const countBefore = before.count || 0;

    // Fire test notification
    const { status, body } = await apiFetch('/notifications/test', {
        method: 'POST',
        body: JSON.stringify({
            type: 'payment.success',
            title: '✅ Test Payment Confirmed',
            message: 'Your payment of ₦5,000 was received.',
        }),
    });

    if (status === 200 && body.success) {
        ok(`POST /notifications/test → fired successfully`);
    } else {
        fail(`POST /notifications/test → HTTP ${status}: ${JSON.stringify(body)}`);
        return;
    }

    // Small delay for DB write
    await new Promise(r => setTimeout(r, 400));

    // Verify count went up
    const { body: after } = await apiFetch('/notifications/unread-count');
    const countAfter = after.count || 0;

    if (countAfter > countBefore) {
        ok(`Unread count went ${countBefore} → ${countAfter} ✓`);
    } else {
        fail(`Unread count did not increase (stayed at ${countBefore})`);
    }

    // Verify it appears in list
    const { body: list } = await apiFetch('/notifications');
    const found = (list.data || []).find(n => n.title === '✅ Test Payment Confirmed');
    if (found) {
        ok(`Notification appears in GET /notifications list → id=${found.id}`);

        // Mark it read
        const { status: ms } = await apiFetch(`/notifications/${found.id}/read`, { method: 'PATCH' });
        ms === 200 ? ok(`PATCH /notifications/${found.id}/read → 200 OK`) : fail(`Mark read failed: ${ms}`);
    } else {
        fail(`Notification not found in list — check NotificationService logs`);
    }

    // Mark all read
    const { status: mar } = await apiFetch('/notifications/read-all', { method: 'PATCH' });
    mar === 200 ? ok(`PATCH /notifications/read-all → 200 OK`) : fail(`Mark all read failed: ${mar}`);
}

// ── Test 4: Real-time socket ──────────────────────────────────
async function testRealtime() {
    section('4. Real-time Socket (socket.io notification.new)');

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            fail(`Timed out — socket did not receive 'notification.new' within 5s`);
            log(`${YELLOW}Hint: Check that backend is running and socket.io is mounted correctly.${RESET}`);
            socket.disconnect();
            resolve();
        }, 5000);

        const socket = io(BACKEND_URL, {
            auth: { token },
            transports: ['websocket', 'polling'],
        });

        socket.on('connect', () => {
            ok(`Socket connected → id=${socket.id}`);
            // Join user room
            socket.emit('join:user', userId);
            ok(`Emitted join:user for userId=${userId}`);

            // Give 200ms for room join, then fire a notification
            setTimeout(async () => {
                await apiFetch('/notifications/test', {
                    method: 'POST',
                    body: JSON.stringify({
                        type: 'order.created',
                        title: '📦 Real-time Test Order',
                        message: 'Socket delivery test',
                    }),
                });
                log(`  → Fired test notification, waiting for socket event...`);
            }, 200);
        });

        socket.on('notification.new', (payload) => {
            clearTimeout(timeout);
            ok(`Received 'notification.new' event in real-time! ✓`);
            log(`    type="${payload.type}", title="${payload.title}"`);
            socket.disconnect();
            resolve();
        });

        socket.on('connect_error', (err) => {
            clearTimeout(timeout);
            fail(`Socket connection error: ${err.message}`);
            log(`${YELLOW}Hint: Is the backend server running at ${BACKEND_URL}?${RESET}`);
            resolve();
        });
    });
}

// ── Run all ───────────────────────────────────────────────────
async function run() {
    console.log(`\n${BOLD}Notification System — E2E Tests${RESET}`);
    console.log(`Backend : ${BACKEND_URL}`);
    console.log(`Tenant  : ${TENANT_ID}`);
    console.log(`Login   : ${EMAIL}`);

    try {
        await testAuth();
        await testRestAPI();
        await testInAppDelivery();
        await testRealtime();
    } catch (err) {
        fail(`Unexpected error: ${err.message}`);
        console.error(err);
    }

    // Summary
    const total = passed + failed;
    console.log(`\n${BOLD}Results: ${GREEN}${passed} passed${RESET}${BOLD}, ${failed > 0 ? RED : ''}${failed} failed${RESET}${BOLD} / ${total} total${RESET}\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run();
