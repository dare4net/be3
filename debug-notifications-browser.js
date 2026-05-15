/**
 * Browser Console Debug Script
 * Paste this into your browser DevTools console while on the storefront (logged in)
 * It tests the full chain: auth → API → socket → real-time delivery
 */

(async () => {
    const BASE = 'http://localhost:3000';
    const TOKEN = localStorage.getItem('auth_token');
    const USER_RAW = localStorage.getItem('auth_user');
    const TENANT = document.cookie.match(/tenant_id=([^;]+)/)?.[1] ||
                   localStorage.getItem('tenant_id') ||
                   'cbe1df05-45ed-455a-9ce6-156b0bd45713';

    const pass = (m) => console.log(`%c✓ ${m}`, 'color:green;font-weight:bold');
    const fail = (m) => console.error(`✗ ${m}`);
    const info = (m) => console.log(`%c  ${m}`, 'color:gray');

    console.log('%c--- Notification Debug ---', 'font-size:14px;font-weight:bold');

    // 1. Check auth
    if (!TOKEN) return fail('No auth_token in localStorage — are you logged in?');
    const user = JSON.parse(USER_RAW || '{}');
    pass(`Logged in as ${user.email} (id=${user.id})`);

    const h = { 'Authorization': `Bearer ${TOKEN}`, 'X-Tenant-ID': TENANT, 'Content-Type': 'application/json' };

    // 2. Unread count
    try {
        const r = await fetch(`${BASE}/notifications/unread-count`, { headers: h });
        const d = await r.json();
        r.ok ? pass(`/notifications/unread-count → ${d.count} unread`) : fail(`/notifications/unread-count → ${r.status}`);
    } catch(e) { fail(`/notifications/unread-count failed: ${e.message}`); }

    // 3. Fire test notification
    try {
        const r = await fetch(`${BASE}/notifications/test`, {
            method: 'POST', headers: h,
            body: JSON.stringify({ type: 'payment.success', title: '🧪 Browser Console Test', message: 'If you see this in the bell, everything works!' })
        });
        const d = await r.json();
        r.ok ? pass(`/notifications/test → fired to userId=${user.id}`) : fail(`/notifications/test → ${r.status}: ${JSON.stringify(d)}`);
    } catch(e) { fail(`/notifications/test failed: ${e.message}`); }

    // 4. Verify notification appears
    await new Promise(r => setTimeout(r, 500));
    try {
        const r = await fetch(`${BASE}/notifications?per_page=5`, { headers: h });
        const d = await r.json();
        const found = (d.data || []).find(n => n.title === '🧪 Browser Console Test');
        found ? pass(`Notification found in DB → id=${found.id}`) : fail('Notification NOT in DB list — check backend logs');
    } catch(e) { fail(`List fetch failed: ${e.message}`); }

    // 5. Check socket
    info('Check your browser Network tab → WS connections for socket.io');
    info('Also check for "Socket Connected" in the browser console');

    console.log('%c--- If bell is not showing: ---', 'color:orange;font-weight:bold');
    info('1. Make sure storefront dev server was restarted after changes');
    info('2. Look for RED errors in the console (firebase, socket, cn import errors)');
    info('3. The bell only shows when isAuthenticated=true (user must be logged in)');
    info('4. After firing test above, click the bell icon in the header');
})();
