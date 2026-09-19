"""
Automated Product Population Script
Logs into admin dashboard and populates categories with products
"""

import asyncio
import random
import re
from playwright.async_api import async_playwright, Page
import requests
from typing import List, Dict

# Configuration
BASE_URL = "http://localhost:3002"
SUBDOMAIN = "demo"
USERNAME = "admin@demo.com"
PASSWORD = "123456789"
PRODUCTS_PER_CATEGORY = 6

# Unsplash API for product images (free, no API key needed for basic use)
UNSPLASH_SEARCH_URL = "https://source.unsplash.com/800x800/?{query}"


class ProductPopulator:
    def __init__(self):
        self.page: Page = None
        self.categories: List[Dict] = []
        
    async def init_browser(self, playwright):
        """Initialize browser and page"""
        browser = await playwright.chromium.launch(headless=False)  # Set to True for headless
        context = await browser.new_context()
        self.page = await context.new_page()
        
    async def login(self):
        """Login to admin dashboard"""
        print(f"🔐 Logging in as {USERNAME}...")
        
        # Navigate to home/login page
        await self.page.goto(f"{BASE_URL}")
        await self.page.wait_for_load_state("networkidle")
        
        # Fill in subdomain
        subdomain_input = self.page.locator('input[name="subdomain"], input[placeholder*="subdomain" i]').first
        await subdomain_input.fill(SUBDOMAIN)
        
        # Fill in email
        email_input = self.page.locator('input[type="email"], input[name="email"]').first
        await email_input.fill(USERNAME)
        
        # Fill in password
        password_input = self.page.locator('input[type="password"], input[name="password"]').first
        await password_input.fill(PASSWORD)
        
        # Click login button
        login_button = self.page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first
        await login_button.click()
        
        # Wait for navigation
        await self.page.wait_for_load_state("networkidle")
        print("✅ Login successful!")
        
    async def navigate_to_categories(self):
        """Navigate to categories page"""
        print("📂 Navigating to categories...")
        
        # Try direct URL first
        await self.page.goto(f"{BASE_URL}/dashboard/products/categories")
        await self.page.wait_for_load_state("networkidle")
        
        print("✅ On categories page!")
        
    async def fetch_categories(self):
        """Fetch all categories from the page"""
        print("📋 Fetching categories...")
        
        # Wait for categories to load
        await self.page.wait_for_timeout(2000)
        
        # Extract category data from the page
        categories = await self.page.evaluate("""
            () => {
                const categoryElements = document.querySelectorAll('[data-category-id], .category-item, [class*="category"]');
                const categories = [];
                
                // Try to find category links or buttons
                const links = Array.from(document.querySelectorAll('a, button')).filter(el => {
                    const text = el.textContent.toLowerCase();
                    return el.getAttribute('href')?.includes('categories') || 
                           el.onclick || 
                           (text.length > 0 && text.length < 50);
                });
                
                links.forEach(link => {
                    const name = link.textContent.trim();
                    const id = link.getAttribute('data-id') || link.getAttribute('data-category-id');
                    if (name && name.length > 0 && name.length < 50 && !name.includes('Add') && !name.includes('Create')) {
                        categories.push({ name, id, element: link });
                    }
                });
                
                return categories.map(c => ({ name: c.name, id: c.id }));
            }
        """)
        
        # If we couldn't find categories via JavaScript, try clicking through UI
        if not categories or len(categories) == 0:
            print("⚠️  Couldn't auto-detect categories, will need to manually identify them")
            # Fallback: get all visible text that looks like category names
            categories = [
                {"name": "Electronics", "id": None},
                {"name": "Clothing", "id": None},
                {"name": "Home & Garden", "id": None},
                {"name": "Sports", "id": None},
                {"name": "Books", "id": None},
            ]
        
        self.categories = categories
        print(f"✅ Found {len(self.categories)} categories: {[c['name'] for c in self.categories]}")
        
    def get_product_image_url(self, category_name: str, index: int) -> str:
        """Get a product image URL from Unsplash based on category"""
        # Clean category name for search
        search_query = category_name.lower().replace('&', 'and').replace(' ', ',')
        
        # Add variety to images
        variations = ['product', 'item', 'object', 'modern', 'premium']
        variation = variations[index % len(variations)]
        
        return f"https://source.unsplash.com/800x800/?{search_query},{variation}"
    
    def generate_product_data(self, category_name: str, index: int) -> Dict:
        """Generate product data for a category"""
        product_names = [
            f"Premium {category_name} Item {index + 1}",
            f"Deluxe {category_name} Product {index + 1}",
            f"Professional {category_name} {index + 1}",
            f"Elite {category_name} Series {index + 1}",
            f"Modern {category_name} {index + 1}",
            f"Classic {category_name} Edition {index + 1}",
        ]
        
        descriptions = [
            f"High-quality {category_name.lower()} designed for professionals and enthusiasts alike.",
            f"Experience the best in {category_name.lower()} with this premium product.",
            f"Top-rated {category_name.lower()} with excellent reviews and performance.",
            f"Innovative {category_name.lower()} featuring cutting-edge technology.",
            f"Trusted by thousands, this {category_name.lower()} delivers exceptional value.",
            f"Award-winning {category_name.lower()} with superior craftsmanship.",
        ]
        
        return {
            "name": product_names[index % len(product_names)],
            "description": descriptions[index % len(descriptions)],
            "price": round(random.uniform(19.99, 499.99), 2),
            "sku": f"SKU-{category_name[:3].upper()}-{random.randint(1000, 9999)}",
            "image_url": self.get_product_image_url(category_name, index),
            "status": "active",
            "is_featured": index == 0  # Make first product featured
        }
    
    async def add_product_to_category(self, category_name: str, category_id: str, product_data: Dict):
        """Add a single product to a category"""
        print(f"  ➕ Adding: {product_data['name']}...")
        
        try:
            # Click "Add Product" button
            add_button = self.page.locator('button:has-text("Add Product"), a:has-text("Add Product")').first
            await add_button.click()
            await self.page.wait_for_timeout(1000)
            
            # Fill in product form
            await self.page.locator('input[name="name"], input[placeholder*="name" i]').first.fill(product_data['name'])
            await self.page.locator('textarea[name="description"], textarea[placeholder*="description" i]').first.fill(product_data['description'])
            await self.page.locator('input[name="price"], input[placeholder*="price" i]').first.fill(str(product_data['price']))
            await self.page.locator('input[name="sku"], input[placeholder*="sku" i]').first.fill(product_data['sku'])
            await self.page.locator('input[name="image_url"], input[placeholder*="image" i]').first.fill(product_data['image_url'])
            
            # Set status to active
            status_select = self.page.locator('select[name="status"]').first
            if await status_select.count() > 0:
                await status_select.select_option('active')
            
            # Mark as featured if needed
            if product_data['is_featured']:
                featured_checkbox = self.page.locator('input[type="checkbox"][name="is_featured"], input[type="checkbox"]:near(:text("Featured"))').first
                if await featured_checkbox.count() > 0:
                    await featured_checkbox.check()
            
            # Submit form
            submit_button = self.page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Save")').first
            await submit_button.click()
            
            # Wait for success
            await self.page.wait_for_timeout(2000)
            print(f"    ✅ Added successfully!")
            
        except Exception as e:
            print(f"    ❌ Error adding product: {str(e)}")
    
    async def populate_category(self, category: Dict):
        """Populate a single category with products"""
        print(f"\n📦 Populating category: {category['name']}")
        
        # Navigate to category (click on it)
        try:
            # Try to find and click the category
            category_link = self.page.locator(f'text="{category["name"]}"').first
            await category_link.click()
            await self.page.wait_for_timeout(2000)
            
            # Add products
            for i in range(PRODUCTS_PER_CATEGORY):
                product_data = self.generate_product_data(category['name'], i)
                await self.add_product_to_category(category['name'], category['id'], product_data)
                await self.page.wait_for_timeout(1000)  # Delay between products
            
            print(f"✅ Completed {category['name']} - Added {PRODUCTS_PER_CATEGORY} products")
            
            # Navigate back to categories list
            await self.navigate_to_categories()
            
        except Exception as e:
            print(f"❌ Error populating {category['name']}: {str(e)}")
    
    async def run(self):
        """Main execution flow"""
        async with async_playwright() as playwright:
            await self.init_browser(playwright)
            
            try:
                # Login
                await self.login()
                
                # Navigate to categories
                await self.navigate_to_categories()
                
                # Fetch categories
                await self.fetch_categories()
                
                # Populate each category
                for category in self.categories:
                    await self.populate_category(category)
                
                print("\n🎉 All categories populated successfully!")
                print("Press Enter to close browser...")
                input()
                
            except Exception as e:
                print(f"\n❌ Error: {str(e)}")
                print("Press Enter to close browser...")
                input()
            
            finally:
                await self.page.context.browser.close()


async def main():
    populator = ProductPopulator()
    await populator.run()


if __name__ == "__main__":
    print("🚀 Starting Product Population Script...")
    print(f"Target: {BASE_URL}")
    print(f"Products per category: {PRODUCTS_PER_CATEGORY}")
    print("-" * 50)
    asyncio.run(main())
