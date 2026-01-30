/**
 * Tenant Initialization Service
 * Seeds new tenants with high-quality sample data and a flagship storefront layout.
 */

const { query } = require('../../../../config/database');
const { tenantInsert } = require('../../../../utils/dbHelpers');
const fs = require('fs');
const path = require('path');

class TenantInitializationService {
    /**
     * Initialize a new tenant with sample data and layout
     */
    static async initialize(tenantId) {
        console.log(`[TenantInit] Initializing tenant ${tenantId}...`);

        try {
            // 1. Seed Categories
            const categories = await this._seedCategories(tenantId);
            const categoryIds = Object.values(categories).map(c => c.id);

            // 2. Seed Products
            await this._seedProducts(tenantId, categories);

            // 3. Seed Flagship Layout & Widgets
            await this._seedLayout(tenantId, categoryIds);

            console.log(`[TenantInit] Successfully initialized tenant ${tenantId}`);
        } catch (error) {
            console.error(`[TenantInit] Failed to initialize tenant ${tenantId}:`, error);
            // We don't throw here to avoid failing the whole signup process
        }
    }

    static async _seedCategories(tenantId) {
        const catData = [
            { name: 'Electronics (Sample)', slug: 'electronics-sample', description: 'Premium gadgets and electronics.' },
            { name: 'Gourmet (Sample)', slug: 'gourmet-sample', description: 'Finest organic food and ingredients.' },
            { name: 'Gaming (Sample)', slug: 'gaming-sample', description: 'High-performance gaming gear.' },
            { name: 'Home & Living (Sample)', slug: 'home-living-sample', description: 'Beautiful decor for your space.' }
        ];

        const seeded = {};
        for (const cat of catData) {
            const result = await tenantInsert('categories', tenantId, {
                ...cat,
                is_active: true
            });
            seeded[cat.name.split(' ')[0]] = result;
        }
        return seeded;
    }

    static async _seedProducts(tenantId, categories) {
        const curatedPath = path.join(process.cwd(), 'scripts', 'curated_products.json');
        if (!fs.existsSync(curatedPath)) {
            console.error(`[TenantInit] Curated products file not found at ${curatedPath}`);
            return;
        }

        const data = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));

        // Map products to categories
        const mapping = {
            'Electronics': data['Gadgets'] || [],
            'Gourmet': data['Food1'] || [],
            'Gaming': data['Gaming'] || [],
            'Home': data['New Cat'] || []
        };

        for (const [key, products] of Object.entries(mapping)) {
            const category = categories[key];
            if (!category) continue;

            // Take up to 4 products per category for the seed
            for (const p of products.slice(0, 4)) {
                const handle = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                const product = await tenantInsert('products', tenantId, {
                    name: p.name + ' (Sample)',
                    description: p.description,
                    price: p.price,
                    image_url: p.image_url,
                    handle: `${handle}-sample`,
                    status: 'active',
                    category_id: category.id,
                    is_featured: true
                });

                // Link to category in many-to-many table
                await query(
                    `INSERT INTO product_categories (tenant_id, product_id, category_id) VALUES ($1, $2, $3)`,
                    [tenantId, product.id, category.id]
                );
            }
        }
    }

    static async _seedLayout(tenantId, categoryIds) {
        // 1. Create Layout
        const layout = await tenantInsert('layouts', tenantId, {
            name: 'Flagship Default',
            description: 'Premium multi-section storefront layout.',
            is_active: true
        });

        // 2. Add Widgets
        const widgets = [
            {
                widget_type: 'announcement_bar',
                sort_order: 0,
                config: {
                    messages: ["Grand Opening! Free Shipping on all orders. (Sample)", "New Premium Collection is Live!"],
                    interval: 4000,
                    backgroundColor: "#1e40af",
                    textColor: "#ffffff"
                }
            },
            {
                widget_type: 'hero',
                sort_order: 1,
                config: {
                    title: {
                        text: "Elevate Your Lifestyle",
                        fontSize: { desktop: "4rem", mobile: "2.5rem" },
                        color: "#ffffff"
                    },
                    subtitle: {
                        text: "Discover our curated collection of premium essentials.",
                        fontSize: { desktop: "1.5rem", mobile: "1.1rem" },
                        color: "#ffffff"
                    },
                    backgroundType: "particles",
                    overlay: { enabled: true, color: "#000000", opacity: 0.5 },
                    height: { desktop: "600px", mobile: "400px" },
                    ctas: [
                        { text: "Shop Now", link: "/products", style: "primary" },
                        { text: "Learn More", link: "/about", style: "outline" }
                    ]
                }
            },
            {
                widget_type: 'trust_badges',
                sort_order: 2,
                config: {
                    badges: [
                        { icon: "ShieldCheck", title: "Secure Checkout", text: "100% encrypted payments" },
                        { icon: "Truck", title: "Fast Delivery", text: "Global shipping in 3 days" },
                        { icon: "Star", title: "Premium Quality", text: "Hand-picked curated items" }
                    ],
                    layout: "grid"
                }
            },
            {
                widget_type: 'category_carousel',
                sort_order: 3,
                config: {
                    title: "Explore Collections",
                    sourceType: 'manual',
                    manualCategoryIds: categoryIds,
                    columns: { desktop: 4, tablet: 2, mobile: 1 },
                    cardShape: 'rounded-square',
                    cardStyle: 'elevated'
                }
            },
            {
                widget_type: 'product_grid',
                sort_order: 4,
                config: {
                    title: "Featured Products",
                    limit: 8,
                    columns: { desktop: 4, tablet: 2, mobile: 1 },
                    showPrice: true,
                    showAddToCart: true,
                    cardStyle: 'elevated'
                }
            },
            {
                widget_type: 'about',
                sort_order: 5,
                config: {
                    title: "Crafting Excellence Since 2024",
                    content: `
                        <p>We started with a simple mission: to bring the world's most unique and high-quality products directly to your doorstep. Every item in our catalog is hand-selected and rigorously tested for quality and sustainability.</p>
                        <p>Our commitment to excellence drives us to scour the globe for artisans and manufacturers who share our passion for perfection. When you shop with us, you're not just buying a product; you're investing in a piece of craftsmanship that tells a story.</p>
                    `,
                    image: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&q=80&w=800",
                    layout: "image-left"
                }
            },
            {
                widget_type: 'stats',
                sort_order: 6,
                config: {
                    stats: [
                        { value: 10000, label: "Happy Customers", suffix: "+", icon: "Users" },
                        { value: 500, label: "Premium Products", suffix: "+", icon: "Package" },
                        { value: 99.9, label: "Satisfaction", suffix: "%", icon: "Star" }
                    ],
                    background: {
                        type: "gradient",
                        gradient: {
                            stops: [{ color: "#3b82f6", position: 0 }, { color: "#8b5cf6", position: 100 }]
                        }
                    }
                }
            },
            {
                widget_type: 'testimonials',
                sort_order: 7,
                config: {
                    title: "What Our Customers Say",
                    testimonials: [
                        { name: "John Doe", text: "The quality of these products is absolutely unmatched. Highly recommended!", rating: 5, role: "Verified Buyer" },
                        { name: "Jane Smith", text: "Fast shipping and fantastic customer support. The keyboard I bought is a dream to type on.", rating: 5, role: "Professional Gamer" },
                        { name: "Mike Ross", text: "I love the curated selection. It saves me so much time finding great gifts for my family.", rating: 5, role: "Tech Enthusiast" }
                    ],
                    columns: 3
                }
            },
            {
                widget_type: 'newsletter',
                sort_order: 8,
                config: {
                    title: "Join the Elite",
                    description: "Subscribe to get early access to new collections and exclusive offers delivered to your inbox.",
                    buttonText: "Subscribe",
                    placeholder: "your@email.com"
                }
            }
        ];

        for (const w of widgets) {
            await tenantInsert('page_widgets', tenantId, {
                ...w,
                page_type: 'home',
                layout_id: layout.id,
                config: JSON.stringify(w.config)
            });
        }
    }
}

module.exports = TenantInitializationService;
