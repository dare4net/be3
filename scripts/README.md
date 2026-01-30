# Product Population Script

Automated script to populate your eCommerce categories with products.

## Setup

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Install Playwright browsers:
```bash
playwright install chromium
```

## Usage

Run the script:
```bash
python populate_products.py
```

The script will:
1. Login to your admin dashboard at `localhost:3003`
2. Navigate to the categories page
3. Fetch all available categories
4. For each category, create 6 products with:
   - Unique names and descriptions
   - Random prices ($19.99 - $499.99)
   - Auto-generated SKUs
   - Product images from Unsplash (relevant to category)
   - Active status
   - First product marked as "Featured"

## Configuration

Edit these variables in `populate_products.py`:

- `BASE_URL`: Your admin dashboard URL (default: `http://localhost:3003`)
- `SUBDOMAIN`: Tenant subdomain (default: `demo`)
- `USERNAME`: Admin email (default: `admin@demo.com`)
- `PASSWORD`: Admin password (default: `123456789`)
- `PRODUCTS_PER_CATEGORY`: Number of products per category (default: `6`)

## Features

- ✅ Automatic login
- ✅ Category detection (both parent and child categories)
- ✅ Product image sourcing from Unsplash
- ✅ Realistic product data generation
- ✅ Error handling and progress reporting
- ✅ Visual browser mode (set `headless=False` to watch it work)

## Notes

- The script uses Unsplash's free image service for product images
- Images are category-relevant (e.g., "Electronics" category gets electronics images)
- The browser stays open at the end so you can verify results
- Press Enter to close the browser when done
