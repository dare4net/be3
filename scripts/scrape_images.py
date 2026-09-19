import asyncio
import json
import os
import random
from playwright.async_api import async_playwright

# Configuration
CATEGORIES_SEARCH = {
    'Food1': [
        {"name": "Organic Hass Avocado", "query": "avocado"},
        {"name": "Grade A Maple Syrup", "query": "maple syrup"},
        {"name": "Artisan Sourdough Bread", "query": "sourdough bread"},
        {"name": "Extra Virgin Olive Oil", "query": "olive oil bottle"},
        {"name": "Himalayan Pink Salt", "query": "pink salt"},
        {"name": "Raw Manuka Honey", "query": "honey jar"}
    ],
    'Gadgets': [
        {"name": "Wireless Noise Cancelling Earbuds", "query": "wireless earbuds"},
        {"name": "Smart Digital Watch", "query": "smartwatch"},
        {"name": "Portable Power Bank", "query": "power bank"},
        {"name": "Mini Portable Projector", "query": "portable projector"},
        {"name": "Mechanical Backlit Keyboard", "query": "mechanical keyboard"},
        {"name": "Smart Home Hub", "query": "smart home device"}
    ],
    'Gaming': [
        {"name": "RGB Wired Gaming Mouse", "query": "gaming mouse"},
        {"name": "4K Ultra-Wide Monitor", "query": "gaming monitor"},
        {"name": "Ergonomic Gaming Chair", "query": "gaming chair"},
        {"name": "Wireless Gaming Controller", "query": "gaming controller"},
        {"name": "Virtual Reality Headset", "query": "vr headset"},
        {"name": "Surround Sound Headset", "query": "gaming headset"}
    ],
    'Laptops & Computers': [
        {"name": "Professional Laptop Pro 14", "query": "macbook pro"},
        {"name": "Business Ultra Laptop", "query": "dell xps laptop"},
        {"name": "Premium 2-in-1 Tablet", "query": "surface pro"},
        {"name": "High-Performance Gaming Laptop", "query": "gaming laptop"},
        {"name": "Portable Workstation Stealth", "query": "thinkpad laptop"},
        {"name": "Slim Convertible Laptop", "query": "ultrabook laptop"}
    ],
    'Smartphones & Tablets': [
        {"name": "Flagship Smartphone 5G", "query": "iphone 16"},
        {"name": "Ultra Smartphone with Stylus", "query": "samsung galaxy phone"},
        {"name": "Pro Smartphone AI Enhanced", "query": "google pixel phone"},
        {"name": "Professional 12.9-inch Tablet", "query": "ipad pro"},
        {"name": "Thin AMOLED Tablet", "query": "android tablet"},
        {"name": "Premium Smartphone Fold", "query": "foldable phone"}
    ],
    'New Cat': [
        {"name": "Minimalist Desk Lamp", "query": "desk lamp"},
        {"name": "Abstract Canvas Wall Art", "query": "abstract wall art"},
        {"name": "Ceramic Scented Candle", "description": "Hand-poured soy wax candle.", "query": "scented candle"},
        {"name": "Modern Succulent Trio", "query": "succulent pots"},
        {"name": "Decorative Woven Blanket", "query": "woven blanket"},
        {"name": "Bamboo Desk Organizer", "query": "desk organizer"}
    ]
}

async def scrape_unsplash():
    print("🚀 Starting Unsplash Image Scraper...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()
        
        results = {}
        
        for category, products in CATEGORIES_SEARCH.items():
            print(f"\n📂 Scraping category: {category}")
            category_results = []
            
            for prod in products:
                name = prod['name']
                query = prod['query']
                print(f"  🔍 Searching for: {name} (Query: {query})...")
                
                try:
                    # Search Unsplash
                    search_url = f"https://unsplash.com/s/photos/{query.replace(' ', '-')}"
                    await page.goto(search_url, wait_until="networkidle")
                    await page.wait_for_timeout(3000)
                    
                    # More resilient selector: look for any image from the unsplash domain that isn't a profile pic
                    # Unsplash main content images usually have a specific aspect ratio or class, 
                    # but targeting the domain is very reliable.
                    image_elements = await page.locator('img[src*="images.unsplash.com/photo-"]').all()
                    
                    image_url = None
                    for img in image_elements:
                        src = await img.get_attribute('src')
                        # Exclude icons, avatars, and ads (which often have different structures)
                        if src and 'profile' not in src and 'plus.unsplash.com' not in src:
                            # Clean the URL to get a good size
                            base_url = src.split('?')[0]
                            image_url = f"{base_url}?auto=format&fit=crop&q=80&w=800"
                            break
                    
                    # Fallback: if no image found, try a simpler 1-word query
                    if not image_url and ' ' in query:
                        simple_query = query.split(' ')[-1]
                        print(f"    🔄 Retrying with simpler query: {simple_query}...")
                        await page.goto(f"https://unsplash.com/s/photos/{simple_query}", wait_until="networkidle")
                        await page.wait_for_timeout(2000)
                        image_elements = await page.locator('img[src*="images.unsplash.com/photo-"]').all()
                        for img in image_elements:
                            src = await img.get_attribute('src')
                            if src and 'profile' not in src and 'plus.unsplash.com' not in src:
                                base_url = src.split('?')[0]
                                image_url = f"{base_url}?auto=format&fit=crop&q=80&w=800"
                                break
                    
                    if image_url:
                        print(f"    ✅ Found: {image_url}")
                        category_results.append({
                            "name": name,
                            "description": prod.get('description', f"Experience the best quality with our {name}. Perfect for your lifestyle."),
                            "price": str(random.randint(15, 150)) + ".99", # Random realistic price
                            "image_url": image_url
                        })
                    else:
                        print(f"    ❌ No image found for: {name}")
                
                except Exception as e:
                    print(f"    ❌ Error scraping {name}: {e}")
            
            results[category] = category_results
            
        await browser.close()
        
        # Save to JSON
        output_path = os.path.join(os.path.dirname(__file__), 'curated_products.json')
        with open(output_path, 'w') as f:
            json.dump(results, f, indent=2)
            
        print(f"\n🎉 Scraping complete! Saved to {output_path}")

if __name__ == "__main__":
    asyncio.run(scrape_unsplash())
