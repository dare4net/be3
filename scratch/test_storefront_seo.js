// Mocking storefront environment
const tenant = {
    name: "Be3 Test Store",
    description: null,
    subdomain: "test-store",
    settings: {
        logo_url: "http://example.com/logo.png"
    }
};

const seo = {
    title: "Test Product",
    meta_description: "A great test product",
    canonical_url: "http://localhost:3003/products/test-product",
    og_title: "Test Product OG",
    og_description: "Test Product OG Description",
    og_image: "http://example.com/image.png",
    og_type: "product",
    twitter_card: "summary_large_image",
    twitter_title: "Test Product Twitter",
    twitter_description: "Test Product Twitter Description",
    twitter_image: "http://example.com/image.png",
    robots: "index,follow"
};

// Simplified mapToNextMetadata logic from storefront-web/lib/seoMapper.js
function mapToNextMetadata(seo, tenant) {
    if (!seo) return {};

    const title = `${seo.title}${tenant ? ` | ${tenant.name}` : ''}`;
    const ogImage = seo.og_image || seo.image_url || tenant?.settings?.logo_url;
    const twitterImage = seo.twitter_image || ogImage;

    return {
        title: title,
        description: seo.meta_description,
        alternates: {
            canonical: seo.canonical_url,
        },
        openGraph: {
            title: seo.og_title || seo.title,
            description: seo.og_description || seo.meta_description,
            type: seo.og_type || 'website',
            images: ogImage ? [{ url: ogImage, width: 1200, height: 630 }] : [],
        },
        twitter: {
            card: seo.twitter_card || 'summary_large_image',
            title: seo.twitter_title || seo.og_title || seo.title,
            description: seo.twitter_description || seo.og_description || seo.meta_description,
            images: twitterImage ? [twitterImage] : [],
        },
        robots: seo.robots || 'index,follow',
    };
}

console.log('--- Testing Storefront SEO Mapper ---');
const metadata = mapToNextMetadata(seo, tenant);
console.log('Mapped Metadata:', JSON.stringify(metadata, null, 2));
