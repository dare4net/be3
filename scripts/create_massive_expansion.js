const http = require('http');

let tenantId = null;
let accessToken = null;

function makeRequest(method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const defaultHeaders = {
            'Content-Type': 'application/json',
            ...headers
        };

        if (tenantId) defaultHeaders['X-Tenant-ID'] = tenantId;
        if (accessToken) defaultHeaders['Authorization'] = `Bearer ${accessToken}`;

        const options = {
            hostname: 'localhost',
            port: 3000,
            path,
            method,
            headers: defaultHeaders
        };

        const req = http.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(responseData) });
                } catch (err) {
                    resolve({ status: res.statusCode, data: responseData });
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function getCategoryByName(name, allCats) {
    if (!allCats) {
        const catsRes = await makeRequest('GET', '/products/categories/all');
        allCats = catsRes.data.categories || [];
    }
    return allCats.find(c => c.name.toLowerCase() === name.toLowerCase());
}

async function createCategory(name, parentId = null) {
    console.log(`Creating ${name}...`);
    const createRes = await makeRequest('POST', '/products/categories', { name, parent_id: parentId });
    if (createRes.status === 201 || createRes.status === 200) {
        console.log(`✅ Created ${name}`);
        return createRes.data.category;
    } else {
        console.error(`⚠️ Failed to create ${name}:`, createRes.data?.message || createRes.data);
        const catsRes = await makeRequest('GET', '/products/categories/all');
        return catsRes.data.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    }
}

async function run() {
    try {
        console.log("Looking up tenant 'Demo'...");
        const lookupRes = await makeRequest('GET', '/tenants/lookup?subdomain=Demo');
        tenantId = lookupRes.data.tenant.id;

        console.log("Logging in as admin...");
        const loginRes = await makeRequest('POST', '/auth/login', { email: 'admin@demo.com', password: '123456789' });
        accessToken = loginRes.data.token || loginRes.data.accessToken;

        let allCatsRes = await makeRequest('GET', '/products/categories/all');
        let allCategories = allCatsRes.data.categories || [];

        // --- MERGE 1: Phone Accessories ---
        console.log("\n--- Merging into Phone Accessories ---");
        const phoneAcc = await getCategoryByName('Phone Accessories', allCategories);
        if (phoneAcc) {
            await createCategory('Cases & Covers', phoneAcc.id);
            await createCategory('Power Banks', phoneAcc.id);
            await createCategory('Chargers & Cables', phoneAcc.id);
            await createCategory('Wearable Tech', phoneAcc.id);
        } else {
            console.error("❌ Phone Accessories root NOT FOUND!");
        }

        const smartphonesAndTablets = await getCategoryByName('Smartphones & Tablets', allCategories);
        if (smartphonesAndTablets) {
            await createCategory('Feature Phones', smartphonesAndTablets.id);
        }

        // --- MERGE 2: Food ---
        console.log("\n--- Merging into Food ---");
        const foodRoot = await getCategoryByName('Food', allCategories);
        if (foodRoot) {
            await createCategory('Beverages', foodRoot.id);
            await createCategory('Snacks & Confectionery', foodRoot.id);
            await createCategory('Canned & Packaged Foods', foodRoot.id);
        } else {
            console.error("❌ Food root NOT FOUND!");
        }

        // --- MERGE 3: Home Decor ---
        console.log("\n--- Merging into Home Decor ---");
        const homeDecor = await getCategoryByName('Home Decor', allCategories);
        if (homeDecor) {
            await createCategory('Lighting', homeDecor.id);
            await createCategory('Rugs & Carpets', homeDecor.id);
            await createCategory('Wall Art', homeDecor.id);
            await createCategory('Bed & Bath', homeDecor.id);
        } else {
            console.error("❌ Home Decor root NOT FOUND!");
        }

        // --- NEW ROOT: Furniture & Organization ---
        console.log("\n--- Creating Furniture & Organization Root ---");
        const furnRoot = await createCategory('Furniture & Organization', null);
        if (furnRoot) {
            await createCategory('Living Room Furniture', furnRoot.id);
            await createCategory('Bedroom Furniture', furnRoot.id);
            await createCategory('Office Furniture', furnRoot.id);
        }

        // --- NEW ROOT: Automobile ---
        console.log("\n--- Creating Automobile Root ---");
        const autoRoot = await createCategory('Automobile', null);
        if (autoRoot) {
            await createCategory('Car Care', autoRoot.id);
            await createCategory('Car Electronics', autoRoot.id);
            await createCategory('Interior Accessories', autoRoot.id);
        }

        // --- NEW ROOT: Sporting Goods ---
        console.log("\n--- Creating Sporting Goods Root ---");
        const sportRoot = await createCategory('Sporting Goods', null);
        if (sportRoot) {
            await createCategory('Fitness & Exercise', sportRoot.id);
            await createCategory('Outdoor Sports', sportRoot.id);
            await createCategory('Team Sports', sportRoot.id);
        }

        // --- NEW ROOT: Supermarket Essentials (Non-Food) ---
        console.log("\n--- Creating Supermarket Essentials Root ---");
        const superRoot = await createCategory('Supermarket Essentials', null);
        if (superRoot) {
            await createCategory('Household Cleaning', superRoot.id);
            await createCategory('Paper & Plastic Products', superRoot.id);
            await createCategory('Pet Supplies', superRoot.id);
        }

        // --- NEW ROOT: Toys, Kids & Babies ---
        console.log("\n--- Creating Toys, Kids & Babies Root ---");
        const toysRoot = await createCategory('Toys, Kids & Babies', null);
        if (toysRoot) {
            await createCategory('Action Figures & Collectibles', toysRoot.id);
            await createCategory('Baby Care', toysRoot.id);
            await createCategory('Educational Toys', toysRoot.id);
        }

        console.log("\n🎉 Massive surgical expansion completed successfully!");

    } catch (e) {
        console.error("❌ Fatal Error:", e);
    }
}

run();
