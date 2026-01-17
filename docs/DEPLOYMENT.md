# Production Deployment Guide

## Overview

This guide covers deploying the Multi-Tenant SaaS eCommerce Platform to production.

## Prerequisites

- Node.js 18+ server
- PostgreSQL 13+ database
- Redis 6+ instance
- SSL certificates
- Domain with DNS access
- (Optional) CDN for static assets

## Pre-Deployment Checklist

### 1. Security

- [ ] Generate strong JWT secrets (minimum 64 characters)
- [ ] Configure database SSL/TLS
- [ ] Enable Redis authentication
- [ ] Set up firewall rules
- [ ] Configure HTTPS/SSL certificates
- [ ] Review CORS origins
- [ ] Enable helmet security headers
- [ ] Set secure cookie flags

### 2. Database

- [ ] Create production database
- [ ] Run all schema migrations
- [ ] Set up automated backups
- [ ] Configure connection pooling
- [ ] Create read replicas (if needed)
- [ ] Set up point-in-time recovery

### 3. Environment

- [ ] Create production `.env` file
- [ ] Set `NODE_ENV=production`
- [ ] Configure all API keys
- [ ] Set rate limiting thresholds
- [ ] Configure email service
- [ ] Set payment provider credentials

## Environment Variables

### Required Variables

```bash
# Environment
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
DB_HOST=your-db-host.com
DB_PORT=5432
DB_NAME=saas_ecommerce_prod
DB_USER=app_user
DB_PASSWORD=<strong-password>
DB_POOL_MIN=5
DB_POOL_MAX=20
DB_SSL=true

# Redis
REDIS_HOST=your-redis-host.com
REDIS_PORT=6379
REDIS_PASSWORD=<strong-password>
REDIS_DB=0
REDIS_TLS=true

# JWT Tokens (CRITICAL: Use strong random strings)
JWT_ACCESS_SECRET=<64-char-random-string>
JWT_REFRESH_SECRET=<64-char-random-string>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Security
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Super Admin
SUPER_ADMIN_EMAIL=admin@yourplatform.com
SUPER_ADMIN_PASSWORD=<strong-initial-password>

# Module Toggles
MODULE_STOREFRONT_ENABLED=true
MODULE_PRODUCTS_ENABLED=true
MODULE_CART_ENABLED=true
MODULE_CHECKOUT_ENABLED=true
MODULE_ORDERS_ENABLED=true
MODULE_PAYMENTS_ENABLED=true
MODULE_SHIPPING_ENABLED=true
MODULE_MARKETING_ENABLED=true
MODULE_ANALYTICS_ENABLED=true

# Payment Providers
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...

# Email (SMTP)
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=noreply@yourplatform.com

# Logging
LOG_LEVEL=info
```

### Generate Secure Secrets

```bash
# Generate JWT secrets (64 characters)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Database Setup

### 1. Create Production Database

```bash
# SSH into database server
createdb saas_ecommerce_prod
```

### 2. Run Migrations

Create a migration runner script:

**database/migrate.js:**
```javascript
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigrations() {
  const schemas = [
    // Core platform schemas
    'platform/events/database/schema.sql',
    'platform/core/auth/database/schema.sql',
    'platform/core/tenants/database/schema.sql',
    'platform/core/roles/database/schema.sql',
    'platform/core/subscriptions/database/schema.sql',
    'platform/core/module_registry/database/schema.sql',
    
    // Feature module schemas
    'modules/products/database/schema.sql',
    'modules/cart/database/schema.sql',
    'modules/orders/database/schema.sql',
    'modules/payments/database/schema.sql',
  ];

  for (const schemaPath of schemas) {
    const fullPath = path.join(__dirname, '..', schemaPath);
    if (fs.existsSync(fullPath)) {
      const sql = fs.readFileSync(fullPath, 'utf8');
      console.log(`Running migration: ${schemaPath}`);
      await pool.query(sql);
    }
  }

  console.log('✓ All migrations completed');
  await pool.end();
}

runMigrations().catch(console.error);
```

Run migrations:
```bash
node database/migrate.js
```

### 3. Seed Initial Data

**database/seed.js:**
```javascript
const { query } = require('../config/database');

async function seed() {
  // Create subscription plans
  const starterPlan = await query(`
    INSERT INTO subscription_plans (name, description, price_monthly, price_yearly)
    VALUES ('Starter', 'Perfect for small businesses', 29.99, 299.99)
    RETURNING *
  `);

  const proPlan = await query(`
    INSERT INTO subscription_plans (name, description, price_monthly, price_yearly)
    VALUES ('Professional', 'For growing businesses', 99.99, 999.99)
    RETURNING *
  `);

  // Add modules to plans
  const modules = ['storefront', 'products', 'cart', 'checkout', 'orders', 'payments'];
  
  for (const module of modules) {
    await query(`
      INSERT INTO plan_modules (plan_id, module_name, is_enabled)
      VALUES ($1, $2, true), ($3, $4, true)
    `, [starterPlan.rows[0].id, module, proPlan.rows[0].id, module]);
  }

  // Add advanced modules to Pro plan only
  const advancedModules = ['shipping', 'marketing', 'analytics'];
  for (const module of advancedModules) {
    await query(`
      INSERT INTO plan_modules (plan_id, module_name, is_enabled)
      VALUES ($1, $2, true)
    `, [proPlan.rows[0].id, module]);
  }

  // Register modules in catalog
  const allModules = [
    { name: 'storefront', display_name: 'Storefront', version: '1.0.0', is_core: false },
    { name: 'products', display_name: 'Products', version: '1.0.0', is_core: false },
    { name: 'cart', display_name: 'Shopping Cart', version: '1.0.0', is_core: false },
    { name: 'checkout', display_name: 'Checkout', version: '1.0.0', is_core: false },
    { name: 'orders', display_name: 'Orders', version: '1.0.0', is_core: false },
    { name: 'payments', display_name: 'Payments', version: '1.0.0', is_core: false },
    { name: 'shipping', display_name: 'Shipping', version: '1.0.0', is_core: false },
    { name: 'marketing', display_name: 'Marketing', version: '1.0.0', is_core: false },
    { name: 'analytics', display_name: 'Analytics', version: '1.0.0', is_core: false },
  ];

  for (const mod of allModules) {
    await query(`
      INSERT INTO modules (name, display_name, version, is_core, description)
      VALUES ($1, $2, $3, $4, $5)
    `, [mod.name, mod.display_name, mod.version, mod.is_core, `${mod.display_name} module`]);
  }

  console.log('✓ Database seeded successfully');
  process.exit(0);
}

seed().catch(console.error);
```

Run seed:
```bash
node database/seed.js
```

## Server Deployment

### Option 1: PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Start application
pm2 start server.js --name saas-ecommerce -i max

# Configure auto-restart on reboot
pm2 startup
pm2 save

# Monitor
pm2 monit
pm2 logs saas-ecommerce
```

**ecosystem.config.js** (PM2 config):
```javascript
module.exports = {
  apps: [{
    name: 'saas-ecommerce',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
  }],
};
```

### Option 2: Docker

**Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:13-alpine
    environment:
      POSTGRES_DB: saas_ecommerce_prod
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:6-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

Deploy:
```bash
docker-compose up -d
```

### Option 3: systemd Service

**`/etc/systemd/system/saas-ecommerce.service`:**
```ini
[Unit]
Description=SaaS eCommerce Platform
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/saas-ecommerce
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable saas-ecommerce
sudo systemctl start saas-ecommerce
sudo systemctl status saas-ecommerce
```

## Reverse Proxy (Nginx)

### Wildcard Subdomain Setup

**`/etc/nginx/sites-available/saas-ecommerce`:**
```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name *.yourplatform.com yourplatform.com;
    return 301 https://$host$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name *.yourplatform.com yourplatform.com;

    # SSL certificates (wildcard cert)
    ssl_certificate /etc/letsencrypt/live/yourplatform.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourplatform.com/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # API endpoints
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20;
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/saas-ecommerce /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Get wildcard certificate
sudo certbot certonly --manual --preferred-challenges dns -d "*.yourplatform.com" -d "yourplatform.com"

# Add TXT record to DNS as instructed, then continue

# Auto-renewal
sudo certbot renew --dry-run
```

## DNS Configuration

Add these DNS records:

```
Type    Name                Value               TTL
A       @                   <server-ip>         300
A       *                   <server-ip>         300
CNAME   www                 yourplatform.com    300
TXT     @                   <certbot-challenge> 300
```

## Monitoring & Logging

### 1. Application Logging

Configure logging in production:

**utils/logger.js:**
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

module.exports = logger;
```

### 2. Database Monitoring

```sql
-- Create monitoring views
CREATE VIEW active_subscriptions AS
SELECT t.name, t.subdomain, sp.name as plan_name, s.status
FROM subscriptions s
JOIN tenants t ON s.tenant_id = t.id
JOIN subscription_plans sp ON s.plan_id = sp.id
WHERE s.status = 'active';

-- Query slow queries
SELECT * FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;
```

### 3. Health Checks

Configure uptime monitoring:
- Endpoint: `https://yourplatform.com/health`
- Expected: `200 OK` with `{"status":"healthy"}`
- Interval: 60 seconds

### 4. Error Tracking

Integrate Sentry:

```bash
npm install @sentry/node
```

**server.js:**
```javascript
const Sentry = require('@sentry/node');

if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: 'production',
  });
}
```

## Performance Optimization

### 1. Database Indexing

Verify indexes are created:
```sql
-- Check indexes
SELECT tablename, indexname FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY tablename, indexname;
```

### 2. Redis Caching

Increase cache TTL in production:
```javascript
// config/redis.js
const CACHE_TTL = process.env.NODE_ENV === 'production' ? 3600 : 600;
```

### 3. Connection Pooling

Tune PostgreSQL pool:
```javascript
// config/database.js
min: 10,  // Production: higher minimum
max: 50,  // Production: higher maximum
```

### 4. Compression

Enable gzip (already configured in server.js):
```javascript
app.use(compression());
```

## Backup & Recovery

### Database Backups

Automated daily backups:

**backup.sh:**
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/postgres"
DB_NAME="saas_ecommerce_prod"

mkdir -p $BACKUP_DIR

pg_dump -U app_user -h localhost $DB_NAME | gzip > $BACKUP_DIR/backup_$DATE.sql.gz

# Keep only last 30 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +30 -delete

echo "Backup completed: backup_$DATE.sql.gz"
```

Schedule with cron:
```bash
# Daily backup at 2 AM
0 2 * * * /path/to/backup.sh
```

### Redis Persistence

Configure Redis AOF:
```bash
# /etc/redis/redis.conf
appendonly yes
appendfsync everysec
```

## Security Hardening

### 1. Firewall Rules

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 2. Database Security

```sql
-- Create app user with limited privileges
CREATE USER app_user WITH PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE saas_ecommerce_prod TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Revoke dangerous privileges
REVOKE ALL ON SCHEMA public FROM PUBLIC;
```

### 3. Rate Limiting

Already configured via middleware. Tune for production:
```javascript
// .env
RATE_LIMIT_MAX_REQUESTS=1000  // Higher for production
```

## Scaling Strategies

### Horizontal Scaling

1. **Load Balancer** (Nginx/HAProxy)
2. **Multiple App Instances** (PM2 cluster mode)
3. **Redis for Session Storage** (already implemented)
4. **Database Read Replicas**

### Vertical Scaling

Increase server resources:
- CPU: 4+ cores recommended
- RAM: 8GB+ recommended
- Disk: SSD with 100GB+

## Troubleshooting

### Common Issues

**Issue: Database connection errors**
- Check connection string
- Verify network access
- Check pool settings

**Issue: Redis connection timeout**
- Verify Redis is running
- Check password
- Review firewall rules

**Issue: Module not loading**
- Check environment variables
- Review logs: `pm2 logs`
- Verify database migrations

**Issue: JWT token errors**
- Ensure secrets match across instances
- Check token expiry settings

## Post-Deployment

### 1. Verify Deployment

```bash
# Health check
curl https://yourplatform.com/health

# Create test tenant
curl -X POST https://yourplatform.com/tenants \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","subdomain":"test"}'

# Test authentication
curl -X POST https://test.yourplatform.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'
```

### 2. Monitor Metrics

- CPU usage < 70%
- Memory usage < 80%
- Database connections < max pool
- Response times < 200ms (p95)

### 3. Set Up Alerts

Configure alerts for:
- Server down
- High error rate (>5%)
- Database connection failures
- Disk space < 20%

## Maintenance

### Regular Tasks

**Daily:**
- Monitor error logs
- Check backup completion

**Weekly:**
- Review performance metrics
- Check disk space
- Update dependencies (security patches)

**Monthly:**
- Database vacuum/analyze
- Review access logs
- Test disaster recovery

## Rollback Plan

If deployment fails:

1. **Revert Code:**
   ```bash
   git checkout <previous-commit>
   pm2 restart all
   ```

2. **Restore Database:**
   ```bash
   gunzip < backup_YYYYMMDD.sql.gz | psql saas_ecommerce_prod
   ```

3. **Clear Redis:**
   ```bash
   redis-cli FLUSHALL
   ```

## Support & Resources

- Health: `https://yourplatform.com/health`
- Admin: `https://yourplatform.com/admin`
- Logs: `/var/log/saas-ecommerce/`
- PM2 Dashboard: `pm2 web`

---

**Production Deployment Complete! 🚀**
