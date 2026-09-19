/**
 * Test Script: BloomFilter.js — Pure JS Bloom Filter
 * 
 * Validates: add, test, testMultiple, serialize/deserialize, FPR estimation.
 * Run: node test_bloom_filter.js
 */

const BloomFilter = require('./modules/bloom/services/BloomFilter');

function assert(condition, msg) {
    if (!condition) {
        console.error(`  ✗ FAIL: ${msg}`);
        process.exitCode = 1;
    } else {
        console.log(`  ✓ ${msg}`);
    }
}

console.log('\n=== BloomFilter Unit Tests ===\n');

// --- Test 1: Basic add/test ---
console.log('Test 1: Basic add and test');
const bf = new BloomFilter(1000, 0.01);

bf.add('dell');
bf.add('xps');
bf.add('13');
bf.add('2-in-1');
bf.add('laptop');
bf.add('samsung');
bf.add('galaxy');

assert(bf.test('dell'), 'Known token "dell" should be found');
assert(bf.test('xps'), 'Known token "xps" should be found');
assert(bf.test('laptop'), 'Known token "laptop" should be found');
assert(bf.test('samsung'), 'Known token "samsung" should be found');
assert(!bf.test('spaceship'), 'Unknown token "spaceship" should NOT be found');
assert(!bf.test('dinosaur'), 'Unknown token "dinosaur" should NOT be found');
assert(!bf.test('quantum'), 'Unknown token "quantum" should NOT be found');

// --- Test 2: Case insensitivity ---
console.log('\nTest 2: Case insensitivity');
assert(bf.test('DELL'), 'Uppercase "DELL" should match lowercase "dell"');
assert(bf.test('Dell'), 'Mixed case "Dell" should match');
assert(bf.test('XPS'), '"XPS" should match');

// --- Test 3: testMultiple ---
console.log('\nTest 3: testMultiple');
const result1 = bf.testMultiple(['dell', 'xps', 'spaceship']);
assert(result1.passed === true, 'Should pass (at least one hit)');
assert(result1.hits.length === 2, `Should have 2 hits, got ${result1.hits.length}`);
assert(result1.misses.length === 1, `Should have 1 miss, got ${result1.misses.length}`);
assert(result1.misses[0] === 'spaceship', 'Miss should be "spaceship"');

const result2 = bf.testMultiple(['unicorn', 'dragon', 'phoenix']);
assert(result2.passed === false, 'Should fail (all misses)');
assert(result2.hits.length === 0, 'Should have 0 hits');
assert(result2.misses.length === 3, 'Should have 3 misses');

// --- Test 4: Serialize/Deserialize ---
console.log('\nTest 4: Serialize and deserialize');
const serialized = bf.serialize();
assert(Buffer.isBuffer(serialized), 'Serialized output should be a Buffer');
console.log(`  Serialized size: ${serialized.length} bytes`);

const restored = BloomFilter.deserialize(serialized);
assert(restored.test('dell'), 'Restored filter should find "dell"');
assert(restored.test('samsung'), 'Restored filter should find "samsung"');
assert(!restored.test('spaceship'), 'Restored filter should NOT find "spaceship"');
assert(restored.itemCount === bf.itemCount, `Item count should match: ${restored.itemCount} === ${bf.itemCount}`);
assert(restored.size === bf.size, `Size should match: ${restored.size} === ${bf.size}`);
assert(restored.hashCount === bf.hashCount, `Hash count should match: ${restored.hashCount} === ${bf.hashCount}`);

// --- Test 5: Stats ---
console.log('\nTest 5: Stats');
const stats = bf.stats();
console.log('  Stats:', JSON.stringify(stats, null, 2));
assert(stats.itemCount === 7, `Item count should be 7, got ${stats.itemCount}`);
assert(stats.bitsSet > 0, 'Bits set should be > 0');
assert(parseFloat(stats.fillRatio) < 0.1, `Fill ratio should be low for 7 items in a 1000-item filter, got ${stats.fillRatio}`);

// --- Test 6: Tokenizer simulation ---
console.log('\nTest 6: Tokenizer simulation');
function tokenize(text) {
    return text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
}

const bf2 = new BloomFilter(10000, 0.01);

// Simulate indexing products
const products = [
    'Dell XPS 13 2-in-1',
    'Samsung Galaxy S24 Ultra',
    'iPhone 15 Pro Max',
    'Sony WH-1000XM5 Headphones',
    'Logitech MX Master 3S Mouse'
];

products.forEach(p => {
    tokenize(p).forEach(token => bf2.add(token));
});

console.log(`  Indexed ${products.length} products, ${bf2.itemCount} tokens`);

// Test queries
const q1 = bf2.testMultiple(tokenize('Dell laptop'));
assert(q1.hits.includes('dell'), '"dell" should hit');
assert(q1.misses.includes('laptop'), '"laptop" should miss (not in catalog)');

const q2 = bf2.testMultiple(tokenize('Samsung Galaxy'));
assert(q2.passed === true, '"Samsung Galaxy" should pass');
assert(q2.hits.length === 2, 'Both tokens should hit');

const q3 = bf2.testMultiple(tokenize('Nintendo Switch OLED'));
assert(q3.passed === false, '"Nintendo Switch OLED" should fail completely');

// --- Test 7: False positive rate under load ---
console.log('\nTest 7: FPR estimation under load');
const bf3 = new BloomFilter(5000, 0.01);
for (let i = 0; i < 5000; i++) {
    bf3.add(`product_${i}`);
}

let falsePositives = 0;
const testCount = 10000;
for (let i = 0; i < testCount; i++) {
    if (bf3.test(`nonexistent_${i}_xyz`)) {
        falsePositives++;
    }
}

const measuredFPR = falsePositives / testCount;
const estimatedFPR = bf3.estimatedFPR();
console.log(`  Measured FPR: ${(measuredFPR * 100).toFixed(2)}%`);
console.log(`  Estimated FPR: ${(estimatedFPR * 100).toFixed(2)}%`);
assert(measuredFPR < 0.05, `Measured FPR should be under 5%, got ${(measuredFPR * 100).toFixed(2)}%`);

console.log('\n=== All BloomFilter tests complete ===\n');
