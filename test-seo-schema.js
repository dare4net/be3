const { generateProductSchema } = require('./lib/seoHelpers');

// Mock Product Data
const mockProduct = {
    name: "Test Hair Growth Oil",
    description: "A premium oil for hair growth.",
    sku: "TEST-SKU-123",
    price: 25.00,
    image_url: "https://example.com/image.jpg",
    inventory_quantity: 10,
    track_inventory: true,
    attributes: {
        vendor: "Pressy Store"
    },
    rating_summary: {
        average_rating: 4.5,
        total_ratings: 12
    },
    store_collection: {
        slug: "pressy-store"
    }
};

const baseUrl = "https://be3.shop";

console.log("--- Testing Product Schema Generation ---");
const schema = generateProductSchema(mockProduct, { name: "Hair Care" }, baseUrl);

console.log(JSON.stringify(schema, null, 2));

// Verification Checks
console.log("\n--- Verification ---");
if (schema.brand && schema.brand.name === "Pressy Store") {
    console.log("✅ Brand Name Correct");
} else {
    console.log("❌ Brand Name Missing or Incorrect");
}

if (schema.brand && schema.brand.url === "https://be3.shop/collections/pressy-store") {
    console.log("✅ Brand URL Correct");
} else {
    console.log("❌ Brand URL Missing or Incorrect");
}

if (schema.aggregateRating && schema.aggregateRating.reviewCount === 12) {
    console.log("✅ Aggregate Rating Correct");
} else {
    console.log("❌ Aggregate Rating Missing");
}

if (schema.review && schema.review.author.name === "Verified Customer") {
    console.log("✅ Review Snippet Present");
} else {
    console.log("❌ Review Snippet Missing");
}
