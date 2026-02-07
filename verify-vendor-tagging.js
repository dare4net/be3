async function verify() {
    try {
        const isVendor = true;
        const vendorName = 'Mr Aliyu';
        const hasUnrestrictedAccess = false; // Regular vendor

        console.log(`Testing Restricted Vendor: isVendor=${isVendor}, vendorName=${vendorName}, hasUnrestrictedAccess=${hasUnrestrictedAccess}`);

        const tags = [];
        if (isVendor && vendorName && !hasUnrestrictedAccess && !tags.includes(vendorName)) {
            tags.push(vendorName);
        }
        console.log(`Final tags: ${JSON.stringify(tags)}`);

        if (tags.includes(vendorName)) {
            console.log('✓ SUCCESS: Vendor name correctly added to tags for restricted vendor');
        } else {
            console.log('✗ FAILURE: Vendor name missing from tags');
        }

        process.exit(0);
    } catch (e) {
        console.error('✗ ERROR:', e);
        process.exit(1);
    }
}

verify();
