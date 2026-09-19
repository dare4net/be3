const { query } = require('../../config/database');

/**
 * Validates and Calculates the canonical shipping totals securely within the backend
 * by consulting the raw Database topology zones for each product vendor.
 * 
 * @param {string} tenantId - The tenant UUID
 * @param {Array} cartItems - Array of raw cart item rows joined with 'products' table metadata
 * @param {Object} destination - Destination context with { country_id, state_id, landmark_id }
 * @returns {Promise<Object>} { total_fee, breakdowns } 
 */
async function calculateSecureShipping(tenantId, cartItems, destination) {
    if (!cartItems || cartItems.length === 0 || !destination) {
        return { total_fee: 0, breakdowns: {} };
    }

    const { country_id, state_id, landmark_id } = destination;

    // Group items by vendor
    const vendorGroups = {};
    for (const item of cartItems) {
        const vId = item.vendor_id;
        if (!vId) continue;
        if (!vendorGroups[vId]) {
            vendorGroups[vId] = [];
        }
        vendorGroups[vId].push(item);
    }

    const results = {};
    let total_fee = 0;

    for (const [vendorId, items] of Object.entries(vendorGroups)) {
        // 1. Fetch Vendor Config
        const vConfRes = await query(`SELECT * FROM vendor_shipping_configs WHERE tenant_id = $1 AND vendor_id = $2`, [tenantId, vendorId]);
        const vConfig = vConfRes.rows[0] || { global_base_fee: 1500, global_processing_min: 1, global_processing_max: 2 };

        // 2. Fetch Zonal Rules matching the destination
        const vZonesRes = await query(`
            SELECT * FROM vendor_shipping_zones WHERE tenant_id = $1 AND vendor_id = $2 
            AND (
                (location_type = 'country' AND location_id = $3) OR
                (location_type = 'state' AND location_id = $4) OR
                (location_type = 'landmark' AND location_id = $5)
            )
        `, [tenantId, vendorId, country_id || 0, state_id || 0, landmark_id || 0]);

        const zones = vZonesRes.rows;
        const landmarkZone = zones.find(z => z.location_type === 'landmark');
        const stateZone = zones.find(z => z.location_type === 'state');
        const countryZone = zones.find(z => z.location_type === 'country');

        // Note: For strict mode calculation on checkout, if they don't cover it, we throw an Error
        if (!countryZone && !stateZone && !landmarkZone) {
            throw new Error(`Vendor ${vendorId} does not deliver to the selected location.`);
        }

        const fallbackMultiplier = landmarkZone?.multiplier ?? stateZone?.multiplier ?? countryZone?.multiplier ?? 1;
        const fallbackTransitMin = landmarkZone?.transit_min ?? stateZone?.transit_min ?? countryZone?.transit_min ?? 1;
        const fallbackTransitMax = landmarkZone?.transit_max ?? stateZone?.transit_max ?? countryZone?.transit_max ?? 3;

        let highestFee = 0;
        let highestDaysMin = 0;
        let highestDaysMax = 0;

        // 3. Process each item
        for (const item of items) {
            // Data maps identically whether item.product is embedded (via frontend /shipping/calculate) 
            // or if we flattened the JOIN fields onto the item object directly (via checkout routes)
            const pData = item.product || item || {};

            // Calculate Fee
            const itemBaseFee = parseFloat(pData.shipping_base_fee_override ?? vConfig.global_base_fee ?? 0);
            const activeMultiplier = pData.disable_shipping_multiplier ? 1 : fallbackMultiplier;
            const itemShippingFee = itemBaseFee * parseFloat(activeMultiplier);

            // Calculate Logistics
            const processMin = pData.processing_min_override ?? vConfig.global_processing_min ?? 1;
            const processMax = pData.processing_max_override ?? vConfig.global_processing_max ?? 2;
            const transitMin = pData.transit_min_override ?? fallbackTransitMin;
            const transitMax = pData.transit_max_override ?? fallbackTransitMax;

            const itemDaysMin = processMin + transitMin;
            const itemDaysMax = processMax + transitMax;

            // Aggregate
            if (itemShippingFee > highestFee) highestFee = itemShippingFee;
            if (itemDaysMin > highestDaysMin) highestDaysMin = itemDaysMin;
            if (itemDaysMax > highestDaysMax) highestDaysMax = itemDaysMax;
        }

        results[vendorId] = {
            fee: highestFee,
            delivery_days_min: highestDaysMin,
            delivery_days_max: highestDaysMax,
            currency: 'NGN'
        };
        total_fee += highestFee;
    }

    return { total_fee, breakdowns: results };
}

module.exports = { calculateSecureShipping };
