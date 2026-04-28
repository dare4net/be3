const db = require('../config/database');
const service = require('../modules/search/services/ClauseTraversalService');

(async () => {
    const tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
    const fashionId = '5f0a09a7-7f88-4d9f-a6d9-a18311b3387e';
    const smartphoneId = '7b8b5bb4-7878-4203-a550-a0941e1e3eb9';

    // Check what attributes Fashion has
    const linkedAttrs = await service.getLinkedAttributes(tenantId, fashionId);
    console.log('Fashion linked attributes:', linkedAttrs.map(a => a.code).join(', ') || '(none)');

    // Try Fashion with gender attribute
    console.log('\n═══ MODE 1: Fashion + gender ═══');
    const m1a = await service.traverse(tenantId, {
        mode: 'category_fixed_attribute_traverse_clauses',
        categoryId: fashionId,
        attributeCode: 'gender',
        maxItems: 10
    });
    console.log(`Cards: ${m1a.length}`);
    m1a.forEach(c => console.log(`  • ${c.title} → ${c.pretty_url} | img: ${c.image_url ? '✅' : '❌'}`));

    // Try Fashion with color
    console.log('\n═══ MODE 1: Fashion + color (c) ═══');
    const m1b = await service.traverse(tenantId, {
        mode: 'category_fixed_attribute_traverse_clauses',
        categoryId: fashionId,
        attributeCode: 'c',
        maxItems: 10
    });
    console.log(`Cards: ${m1b.length}`);
    m1b.forEach(c => console.log(`  • ${c.title} → ${c.pretty_url} | img: ${c.image_url ? '✅' : '❌'}`));

    // Try Smartphones with brand
    console.log('\n═══ MODE 1: Smartphones + brand (b) ═══');
    const m1c = await service.traverse(tenantId, {
        mode: 'category_fixed_attribute_traverse_clauses',
        categoryId: smartphoneId,
        attributeCode: 'b',
        maxItems: 10
    });
    console.log(`Cards: ${m1c.length}`);
    m1c.forEach(c => console.log(`  • ${c.title} → ${c.pretty_url} | img: ${c.image_url ? '✅' : '❌'}`));

    process.exit(0);
})();
