# 🚀 Comprehensive Deployment Guide

This guide provides step-by-step instructions to deploy the Multi-Tenant SaaS eCommerce Platform to production using **Render** (Backend), **Vercel** (Frontends), **Neon** (Postgres), and **Upstash** (Redis).

---

## 🏗️ Architecture Overview

- **Backend API**: Node.js / Express (Deployed on **Render**)
- **Frontends**: Next.js (Deployed on **Vercel**)
  - Storefront (`storefront-web`)
  - Admin Dashboard (`admin-dashboard-web`)
  - Super Admin (`super-admin-web`)
- **Database**: PostgreSQL (Managed by **Neon**)
- **Cache / Rate Limiting**: Redis (Managed by **Upstash**)

---

## 1. 💾 Database Setup (Neon)

1. Create a project at [Neon.tech](https://neon.tech/).
2. Create a new database (e.g., `ecommerce_prod`).
3. Copy the **Connection String** (it will look like `postgres://user:pass@ep-hostname.region.aws.neon.tech/dbname?sslmode=require`).
4. **Important**: Save this as `DATABASE_URL`.

---

## 2. ⚡ Cache Setup (Upstash)

1. Create a Redis database at [Upstash](https://upstash.com/).
2. Select **Global** or the region closest to your Render/Vercel deployment.
3. Access the **REST API** section in the Upstash console.
4. Copy the **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN**.
5. **Note**: The backend now prefers the HTTP client which is more resilient to serverless disconnects.

---

## 3. ⚙️ Backend Deployment (Render)

1. Connect your GitHub repository to [Render](https://render.com/).
2. Create a new **Web Service**.
3. **Environment**: `Node`
4. **Build Command**: `npm install`
5. **Start Command**: `node server.js`
6. **Environment Variables**:
   ```env
   NODE_ENV=production
   PORT=10000
   DATABASE_URL=your_neon_connection_string
   UPSTASH_REDIS_REST_URL=your_upstash_rest_url
   UPSTASH_REDIS_REST_TOKEN=your_upstash_rest_token
   REDIS_URL=your_backup_tcp_redis_url (optional)
   JWT_ACCESS_SECRET=generate_a_long_random_string
   JWT_REFRESH_SECRET=generate_another_long_random_string
   SUPER_ADMIN_EMAIL=your@email.com
   SUPER_ADMIN_PASSWORD=your_secure_password
   ```

---

## 4. 🖼️ Frontend Deployment (Vercel)

You will need to deploy three separate projects on Vercel.

### A. Storefront (`storefront-web`)
1. Import the repository in Vercel.
2. Set the **Root Directory** to `storefront-web`.
3. **Framework Preset**: `Next.js`.
4. **Environment Variables**:
   ```env
   NEXT_PUBLIC_API_URL=https://your-backend-on-render.onrender.com
   NEXT_PUBLIC_TENANT_ID=your_primary_tenant_uuid
   ```

### B. Admin Dashboard (`admin-dashboard-web`)
1. Import the repository again.
2. Set the **Root Directory** to `admin-dashboard-web`.
3. **Environment Variables**:
   ```env
   NEXT_PUBLIC_API_URL=https://your-backend-on-render.onrender.com
   ```

### C. Super Admin (`super-admin-web`)
1. Import the repository again.
2. Set the **Root Directory** to `super-admin-web`.
3. **Environment Variables**:
   ```env
   NEXT_PUBLIC_API_URL=https://your-backend-on-render.onrender.com
   ```

---

## 5. 🔄 Database & Data Migration

To move both your **Schema** and your **Current Data** to Neon, follow these steps:

### Option A: The "Big Bang" Migration (Schema + Data)
This is the easiest way if your Neon database is still empty.

1.  **Dump and Pipe**: Run this command from your local terminal (ensure your `.env` info matches):
    ```bash
    # Replace 'saas_ecommerce' with your local DB name
    # Replace 'YOUR_NEON_URL' with the string from Neon
    pg_dump --no-owner --no-privileges saas_ecommerce | psql "YOUR_NEON_URL"
    ```

### Option B: Schema First, Then Sync
If you've already run `node database/deploy_migrate.js` on Neon:

1.  **Data Only Dump**:
    ```bash
    pg_dump --data-only --no-owner --no-privileges --exclude-table=migrations saas_ecommerce | psql "YOUR_NEON_URL"
    ```

---

## 🛠️ Production Checklist

- [ ] **SSL**: Both Neon and Upstash require SSL/TLS. The backend has been updated to support `DATABASE_URL` and `REDIS_URL` with automatic SSL handling.
- [ ] **CORS**: Currently set to allow all. You should update `server.js` to specific origins if high security is required.
- [ ] **Secrets**: Ensure `JWT_SECRET` values are unique and strong.
- [ ] **Email**: If using notifications, configure `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD` on Render.
- [ ] **Stripe**: Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to the Render environment variables if payments are active.

---

## 🆘 Troubleshooting

- **Redis Connection**: If Upstash fails, ensure you are using `rediss://` (with two 's') in your `REDIS_URL` to enable TLS.
- **Neon Connection**: Ensure `?sslmode=require` is appended to the connection string.
- **Cold Starts**: Render's free tier spins down. Use a "Starter" tier if you want 24/7 availability.
