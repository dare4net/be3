/**
 * BloomFilter — Pure JavaScript Implementation
 * 
 * Uses double-hashing (FNV-1a + Murmur3) to simulate k independent hash functions.
 * Serializable to/from Buffer for Redis persistence.
 * 
 * PRINCIPLE: Zero external dependencies. Runs on any Node.js version.
 */

class BloomFilter {
    /**
     * @param {number} expectedItems - Expected number of items to insert
     * @param {number} falsePositiveRate - Desired false positive rate (e.g., 0.01 = 1%)
     */
    constructor(expectedItems = 50000, falsePositiveRate = 0.01) {
        // Calculate optimal size and hash count
        // m = -(n * ln(p)) / (ln(2)^2)
        // k = (m / n) * ln(2)
        const n = Math.max(expectedItems, 1);
        const p = Math.max(falsePositiveRate, 1e-10);

        this.size = Math.ceil(-(n * Math.log(p)) / (Math.log(2) ** 2));
        this.hashCount = Math.max(1, Math.round((this.size / n) * Math.log(2)));
        this.bitArray = new Uint8Array(Math.ceil(this.size / 8));
        this.itemCount = 0;
        this.expectedItems = expectedItems;
        this.falsePositiveRate = falsePositiveRate;
    }

    /**
     * Add an item to the filter.
     * @param {string} item - The token to add (will be lowercased)
     */
    add(item) {
        const str = String(item).toLowerCase().trim();
        if (!str) return;

        const h1 = BloomFilter._fnv1a(str);
        const h2 = BloomFilter._murmur3(str);

        for (let i = 0; i < this.hashCount; i++) {
            const pos = Math.abs((h1 + i * h2) % this.size);
            this.bitArray[pos >> 3] |= (1 << (pos & 7));
        }

        this.itemCount++;
    }

    /**
     * Test if an item might be in the filter.
     * @param {string} item - The token to test (will be lowercased)
     * @returns {boolean} - true = maybe present, false = definitely absent
     */
    test(item) {
        const str = String(item).toLowerCase().trim();
        if (!str) return false;

        const h1 = BloomFilter._fnv1a(str);
        const h2 = BloomFilter._murmur3(str);

        for (let i = 0; i < this.hashCount; i++) {
            const pos = Math.abs((h1 + i * h2) % this.size);
            if (!(this.bitArray[pos >> 3] & (1 << (pos & 7)))) {
                return false;
            }
        }

        return true;
    }

    /**
     * Test multiple tokens. Returns hits and misses.
     * @param {string[]} tokens
     * @returns {{ passed: boolean, hits: string[], misses: string[] }}
     */
    testMultiple(tokens) {
        const hits = [];
        const misses = [];

        for (const token of tokens) {
            if (this.test(token)) {
                hits.push(token);
            } else {
                misses.push(token);
            }
        }

        return {
            passed: hits.length > 0,
            hits,
            misses
        };
    }

    /**
     * Get estimated false positive rate based on current fill.
     * @returns {number}
     */
    estimatedFPR() {
        // (1 - e^(-kn/m))^k
        const k = this.hashCount;
        const n = this.itemCount;
        const m = this.size;
        return Math.pow(1 - Math.exp((-k * n) / m), k);
    }

    /**
     * Get filter statistics.
     */
    stats() {
        let bitsSet = 0;
        for (let i = 0; i < this.bitArray.length; i++) {
            let byte = this.bitArray[i];
            while (byte) {
                bitsSet += byte & 1;
                byte >>= 1;
            }
        }

        return {
            size: this.size,
            hashCount: this.hashCount,
            itemCount: this.itemCount,
            byteSize: this.bitArray.length,
            bitsSet,
            fillRatio: (bitsSet / this.size).toFixed(4),
            estimatedFPR: this.estimatedFPR().toFixed(6)
        };
    }

    /**
     * Serialize to Buffer for Redis storage.
     * Format: [4B size][4B hashCount][4B itemCount][4B expectedItems][8B falsePositiveRate][...bitArray]
     * @returns {Buffer}
     */
    serialize() {
        const headerSize = 4 + 4 + 4 + 4 + 8; // 24 bytes header
        const buf = Buffer.alloc(headerSize + this.bitArray.length);
        let offset = 0;

        buf.writeUInt32BE(this.size, offset); offset += 4;
        buf.writeUInt32BE(this.hashCount, offset); offset += 4;
        buf.writeUInt32BE(this.itemCount, offset); offset += 4;
        buf.writeUInt32BE(this.expectedItems, offset); offset += 4;
        buf.writeDoubleBE(this.falsePositiveRate, offset); offset += 8;

        // Copy bit array
        Buffer.from(this.bitArray.buffer).copy(buf, offset);

        return buf;
    }

    /**
     * Deserialize a Buffer back into a BloomFilter instance.
     * @param {Buffer} buf
     * @returns {BloomFilter}
     */
    static deserialize(buf) {
        if (!Buffer.isBuffer(buf)) {
            buf = Buffer.from(buf);
        }

        let offset = 0;
        const size = buf.readUInt32BE(offset); offset += 4;
        const hashCount = buf.readUInt32BE(offset); offset += 4;
        const itemCount = buf.readUInt32BE(offset); offset += 4;
        const expectedItems = buf.readUInt32BE(offset); offset += 4;
        const falsePositiveRate = buf.readDoubleBE(offset); offset += 8;

        const filter = new BloomFilter(1, 0.5); // dummy params, we override below
        filter.size = size;
        filter.hashCount = hashCount;
        filter.itemCount = itemCount;
        filter.expectedItems = expectedItems;
        filter.falsePositiveRate = falsePositiveRate;
        filter.bitArray = new Uint8Array(buf.slice(offset));

        return filter;
    }

    // ═══════════════════════════════════════════════
    // HASH FUNCTIONS
    // ═══════════════════════════════════════════════

    /**
     * FNV-1a hash (32-bit)
     * @param {string} str
     * @returns {number}
     */
    static _fnv1a(str) {
        let hash = 0x811c9dc5; // FNV offset basis
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0; // FNV prime, force unsigned
        }
        return hash >>> 0;
    }

    /**
     * Murmur3 hash (32-bit, simplified)
     * @param {string} str
     * @returns {number}
     */
    static _murmur3(str) {
        let hash = 0x12345678; // seed
        const c1 = 0xcc9e2d51;
        const c2 = 0x1b873593;

        for (let i = 0; i < str.length; i++) {
            let k = str.charCodeAt(i);
            k = Math.imul(k, c1);
            k = (k << 15) | (k >>> 17);
            k = Math.imul(k, c2);

            hash ^= k;
            hash = (hash << 13) | (hash >>> 19);
            hash = Math.imul(hash, 5) + 0xe6546b64;
        }

        // Finalization
        hash ^= str.length;
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x85ebca6b);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 0xc2b2ae35);
        hash ^= hash >>> 16;

        return hash >>> 0;
    }
}

module.exports = BloomFilter;
