/**
 * Scripts to seed Nigeria's 36 States + FCT and their popular LGAs/Landmarks.
 */

require('dotenv').config();
const { query, pool } = require('../config/database');

async function seedNigeria() {
    console.log('Seeding Nigeria Locations...');

    try {
        let tenantId = process.env.TENANT_ID;
        if (!tenantId) {
            const tenantRes = await query('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1');
            if (!tenantRes.rows.length) {
                throw new Error('No tenants found. Cannot seed locations.');
            }
            tenantId = tenantRes.rows[0].id;
        }
        console.log(`Using Tenant ID: ${tenantId}`);

        // 1. Insert Country
        const countryRes = await query(`
            INSERT INTO countries (tenant_id, name, code) 
            VALUES ($1, 'Nigeria', 'NG')
            ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
            RETURNING id;
        `, [tenantId]);
        const countryId = countryRes.rows[0].id;

        // 2. Define States and sample Landmarks (LGAs / Popular areas)
        const nigeriaData = {
            "Abia": ["Aba North", "Aba South", "Umuahia North", "Umuahia South", "Ohafia"],
            "Adamawa": ["Yola North", "Yola South", "Mubi North", "Mubi South", "Jimeta"],
            "Akwa Ibom": ["Uyo", "Eket", "Ikot Ekpene", "Oron", "Ibeno"],
            "Anambra": ["Awka North", "Awka South", "Onitsha North", "Onitsha South", "Nnewi North", "Nnewi South", "Ekwulobia"],
            "Bauchi": ["Bauchi Municipal", "Azare", "Misau", "Katagum"],
            "Bayelsa": ["Yenagoa", "Brass", "Sagbama", "Ogbia", "Amassoma"],
            "Benue": ["Makurdi", "Otukpo", "Gboko", "Katsina-Ala"],
            "Borno": ["Maiduguri", "Biu", "Bama", "Jere"],
            "Cross River": ["Calabar Municipal", "Calabar South", "Ikom", "Ogoja", "Obudu"],
            "Delta": ["Asaba", "Warri North", "Warri South", "Effurun", "Ughelli", "Sapele", "Agbor"],
            "Ebonyi": ["Abakaliki", "Afikpo North", "Afikpo South", "Onueke"],
            "Edo": ["Benin City - Oredo", "Benin City - Ikpoba Okha", "Benin City - Egor", "Uromi", "Ekpoma", "Auchi"],
            "Ekiti": ["Ado-Ekiti", "Ikere-Ekiti", "Oye-Ekiti", "Ikole-Ekiti"],
            "Enugu": ["Enugu North", "Enugu South", "Enugu East", "Nsukka", "Awgu", "9th Mile"],
            "Federal Capital Territory (Abuja)": ["Wuse", "Garki", "Maitama", "Asokoro", "Gwarinpa", "Lugbe", "Kubwa", "Utako", "Jabi", "Nyanya", "Kuje"],
            "Gombe": ["Gombe Municipal", "Kaltungo", "Dukin", "Billiri"],
            "Imo": ["Owerri Municipal", "Owerri North", "Owerri West", "Orlu", "Okigwe", "Mbaise"],
            "Jigawa": ["Dutse", "Hadejia", "Kazaure", "Gumel"],
            "Kaduna": ["Kaduna North", "Kaduna South", "Zaria", "Sabon Gari", "Kafanchan"],
            "Kano": ["Kano Municipal", "Fagge", "Dala", "Tarauni", "Nassarawa", "Gwale", "Ungogo", "Kumbotso"],
            "Katsina": ["Katsina Municipal", "Daura", "Funtua", "Malumfashi"],
            "Kebbi": ["Birnin Kebbi", "Argungu", "Yauri", "Zuru"],
            "Kogi": ["Lokoja", "Anyigba", "Okene", "Idah", "Kabba"],
            "Kwara": ["Ilorin West", "Ilorin East", "Ilorin South", "Offa", "Omu-Aran"],
            "Lagos": ["Ikeja", "Victoria Island", "Lekki Phase 1", "Lekki Phase 2", "Surulere", "Yaba", "Ikorodu", "Ajah", "Agege", "Maryland", "Ikoyi", "Apapa", "Oshodi", "Festac", "Alimosho"],
            "Nasarawa": ["Lafia", "Karu", "Keffi", "Akwanga"],
            "Niger": ["Minna", "Suleja", "Bida", "Kontagora"],
            "Ogun": ["Abeokuta South", "Abeokuta North", "Ijebu-Ode", "Sagamu", "Ota", "Sango Ota", "Ilaro", "Mowe", "Ibafo"],
            "Ondo": ["Akure South", "Akure North", "Ondo Town", "Owo", "Okitipupa", "Ikare"],
            "Osun": ["Osogbo", "Ilesa East", "Ilesa West", "Ile-Ife", "Ede", "Ikire"],
            "Oyo": ["Ibadan North", "Ibadan South-West", "Ibadan North-East", "Ogbomosho", "Oyo Town", "Iseyin"],
            "Plateau": ["Jos North", "Jos South", "Bukuru", "Pankshin"],
            "Rivers": ["Port Harcourt City", "Obio-Akpor", "Eleme", "Bonny Island", "Okrika", "Oyigbo"],
            "Sokoto": ["Sokoto North", "Sokoto South", "Wamako", "Tambuwal"],
            "Taraba": ["Jalingo", "Wukari", "Bali", "Gembu"],
            "Yobe": ["Damaturu", "Potiskum", "Gashua", "Nguru"],
            "Zamfara": ["Gusau", "Kaura Namoda", "Maradun", "Talata Mafara"]
        };

        // 3. Insert States and Landmarks
        for (const [stateName, landmarks] of Object.entries(nigeriaData)) {
            // Check if state exists to avoid duplicates if this runs multiple times
            let stateRes = await query(`
                SELECT id FROM states WHERE tenant_id = $1 AND country_id = $2 AND name = $3
            `, [tenantId, countryId, stateName]);

            let stateId;
            if (stateRes.rows.length > 0) {
                stateId = stateRes.rows[0].id;
            } else {
                const insertState = await query(`
                    INSERT INTO states (tenant_id, country_id, name)
                    VALUES ($1, $2, $3) RETURNING id;
                `, [tenantId, countryId, stateName]);
                stateId = insertState.rows[0].id;
            }

            console.log(`- Seeded State: ${stateName}`);

            for (const landmark of landmarks) {
                // Check if landmark exists
                const lmRes = await query(`
                    SELECT id FROM landmarks WHERE tenant_id = $1 AND state_id = $2 AND name = $3
                `, [tenantId, stateId, landmark]);

                if (lmRes.rows.length === 0) {
                    await query(`
                        INSERT INTO landmarks (tenant_id, state_id, name)
                        VALUES ($1, $2, $3)
                    `, [tenantId, stateId, landmark]);
                }
            }
        }

        console.log('✅ Successfully seeded Nigeria States and Landmarks!');
    } catch (err) {
        console.error('❌ Seeding failed:', err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

seedNigeria();
