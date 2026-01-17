// Quick script to reorder routes in products module
const fs = require('fs');

const filePath = './modules/products/index.js';
const content = fs.readFileSync(filePath, 'utf8');

// Find the section with category routes and mark it for moving
const lines = content.split('\n');
let newLines = [];
let categoryRoutesStart = -1;
let categoryRoutesEnd = -1;
let insertPoint = -1;

// Find where to extract category routes (around line 416-489)
// Find where to insert them (after subscriptionGuard line, before route definitions)

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('// CATEGORY ROUTES (Public for widgets)')) {
        categoryRoutesStart = i - 1; // Include the separator line before
    }
    if (categoryRoutesStart > 0 && lines[i].includes("app.use('/products', router)")) {
        categoryRoutesEnd = i - 2; // Before app.use
        break;
    }
    if (lines[i].includes('router.use(subscriptionGuard')) {
        insertPoint = i + 1; // Right after subscription guard
    }
}

console.log(`Category routes: lines ${categoryRoutesStart} to ${categoryRoutesEnd}`);
console.log(`Insert point: line ${insertPoint}`);

// Extract category routes
const categoryRoutes = lines.slice(categoryRoutesStart, categoryRoutesEnd + 1);

// Remove from old location
const withoutCategories = [
    ...lines.slice(0, categoryRoutesStart),
    ...lines.slice(categoryRoutesEnd + 1)
];

// Insert at new location (adjust index since we removed lines)
const adjustedInsertPoint = insertPoint;
const final = [
    ...withoutCategories.slice(0, adjustedInsertPoint),
    '',
    ...categoryRoutes,
    '',
    ...withoutCategories.slice(adjustedInsertPoint)
];

fs.writeFileSync(filePath, final.join('\n'));
console.log('✓ Routes reordered successfully');
