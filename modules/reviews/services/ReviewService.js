/**
 * Review Service
 * Business logic for ratings, reviews, verified buyer checks, and aggregation.
 * 
 * PRINCIPLE: Modules do not import other modules directly
 * Uses created_by as the source of truth for product ownership.
 */

const { query } = require('../../../config/database');

class ReviewService {
    /**
     * Check if a user has purchased a specific product (verified buyer)
     * Cross-module read on orders/order_items — same pattern as ProductService.
     */
    static async isVerifiedBuyer(tenantId, userId, productId) {
        try {
            const res = await query(`
                SELECT o.id FROM orders o
                JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
                WHERE o.tenant_id = $1
                  AND o.user_id = $2
                  AND oi.product_id = $3
                  AND o.status IN ('paid', 'processing', 'shipped', 'completed')
                LIMIT 1
            `, [tenantId, userId, productId]);
            return res.rows.length > 0;
        } catch (e) {
            // Graceful fallback if orders table doesn't exist
            console.warn('[ReviewService] Verified buyer check failed:', e.message);
            return false;
        }
    }

    /**
     * Check if a user is the vendor/owner of a product.
     * Uses created_by as the source of truth.
     */
    static async isProductOwner(tenantId, userId, productId) {
        const res = await query(
            `SELECT id FROM products WHERE id = $1 AND tenant_id = $2 AND created_by = $3`,
            [productId, tenantId, userId]
        );
        return res.rows.length > 0;
    }

    /**
     * Recalculate and upsert the rating summary for a product.
     * Called after any rating create/update/delete.
     */
    static async recalculateSummary(tenantId, productId) {
        try {
            const res = await query(`
                SELECT 
                    COALESCE(AVG(rating), 0) AS average_rating,
                    COUNT(*) AS total_ratings,
                    COUNT(*) FILTER (WHERE rating = 1) AS rating_1,
                    COUNT(*) FILTER (WHERE rating = 2) AS rating_2,
                    COUNT(*) FILTER (WHERE rating = 3) AS rating_3,
                    COUNT(*) FILTER (WHERE rating = 4) AS rating_4,
                    COUNT(*) FILTER (WHERE rating = 5) AS rating_5
                FROM product_ratings
                WHERE tenant_id = $1 AND product_id = $2
            `, [tenantId, productId]);

            const stats = res.rows[0];

            // Count reviews separately
            const reviewCountRes = await query(`
                SELECT COUNT(*) AS total_reviews
                FROM product_reviews
                WHERE tenant_id = $1 AND product_id = $2 
                  AND status = 'published' AND deleted_at IS NULL
            `, [tenantId, productId]);

            const totalReviews = parseInt(reviewCountRes.rows[0]?.total_reviews || 0);

            await query(`
                INSERT INTO product_rating_summary 
                    (tenant_id, product_id, average_rating, total_ratings, total_reviews,
                     rating_1, rating_2, rating_3, rating_4, rating_5, last_updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                ON CONFLICT (tenant_id, product_id)
                DO UPDATE SET
                    average_rating = EXCLUDED.average_rating,
                    total_ratings = EXCLUDED.total_ratings,
                    total_reviews = EXCLUDED.total_reviews,
                    rating_1 = EXCLUDED.rating_1,
                    rating_2 = EXCLUDED.rating_2,
                    rating_3 = EXCLUDED.rating_3,
                    rating_4 = EXCLUDED.rating_4,
                    rating_5 = EXCLUDED.rating_5,
                    last_updated_at = NOW()
            `, [
                tenantId, productId,
                parseFloat(stats.average_rating).toFixed(1),
                parseInt(stats.total_ratings),
                totalReviews,
                parseInt(stats.rating_1),
                parseInt(stats.rating_2),
                parseInt(stats.rating_3),
                parseInt(stats.rating_4),
                parseInt(stats.rating_5)
            ]);
        } catch (e) {
            console.error('[ReviewService] Failed to recalculate summary:', e.message);
        }
    }

    /**
     * Get the rating summary for a product (from cache table).
     */
    static async getSummary(tenantId, productId) {
        const res = await query(
            `SELECT * FROM product_rating_summary WHERE tenant_id = $1 AND product_id = $2`,
            [tenantId, productId]
        );
        return res.rows[0] || {
            average_rating: 0,
            total_ratings: 0,
            total_reviews: 0,
            rating_1: 0, rating_2: 0, rating_3: 0, rating_4: 0, rating_5: 0
        };
    }

    /**
     * Get paginated reviews for a product with all enrichments:
     * - Author name
     * - Author's current rating for this product
     * - Verified purchase status
     * - Helpful vote count
     * - Whether the requesting user has voted
     * - Media attachments
     * - Vendor reply
     */
    static async getProductReviews(tenantId, productId, { page = 1, perPage = 10, requestingUserId = null } = {}) {
        const offset = (page - 1) * perPage;

        // Get product owner for vendor badge + reply authorization
        const ownerRes = await query(
            `SELECT created_by FROM products WHERE id = $1 AND tenant_id = $2`,
            [productId, tenantId]
        );
        const productOwnerId = ownerRes.rows[0]?.created_by || null;

        // Dynamic verified buyer check via EXISTS on orders — never stale
        const reviewsRes = await query(`
            SELECT 
                r.id, r.product_id, r.user_id, r.title, r.body,
                r.status, r.created_at, r.updated_at,
                u.first_name, u.last_name,
                pr.rating AS author_rating,
                (SELECT COUNT(*) FROM review_votes rv WHERE rv.review_id = r.id) AS helpful_count,
                EXISTS (
                    SELECT 1 FROM orders o
                    JOIN order_items oi ON oi.order_id = o.id AND oi.tenant_id = o.tenant_id
                    WHERE o.tenant_id = r.tenant_id
                      AND o.user_id = r.user_id
                      AND oi.product_id = r.product_id
                      AND o.status IN ('paid', 'processing', 'shipped', 'completed')
                ) AS is_verified_purchase,
                (r.user_id = $5) AS is_vendor
            FROM product_reviews r
            LEFT JOIN users u ON u.id = r.user_id AND u.tenant_id = r.tenant_id
            LEFT JOIN product_ratings pr ON pr.user_id = r.user_id 
                AND pr.product_id = r.product_id AND pr.tenant_id = r.tenant_id
            WHERE r.product_id = $1 AND r.tenant_id = $2
              AND r.status = 'published' AND r.deleted_at IS NULL
            ORDER BY r.created_at DESC
            LIMIT $3 OFFSET $4
        `, [productId, tenantId, perPage, offset, productOwnerId]);

        const reviews = reviewsRes.rows;

        // Enrich each review with media, votes, and vendor reply
        for (const review of reviews) {
            // Media
            const mediaRes = await query(
                `SELECT id, url, media_type, position FROM review_media WHERE review_id = $1 ORDER BY position ASC`,
                [review.id]
            );
            review.media = mediaRes.rows;

            // Vendor reply
            const replyRes = await query(`
                SELECT rr.id, rr.body, rr.created_at, rr.updated_at, rr.vendor_id,
                       u.business_name AS vendor_name
                FROM review_replies rr
                LEFT JOIN users u ON u.id = rr.vendor_id AND u.tenant_id = $2
                WHERE rr.review_id = $1 AND rr.tenant_id = $2
                LIMIT 1
            `, [review.id, tenantId]);
            review.vendor_reply = replyRes.rows[0] || null;

            // Has requesting user voted on this review?
            if (requestingUserId) {
                const voteRes = await query(
                    `SELECT id FROM review_votes WHERE review_id = $1 AND user_id = $2 AND tenant_id = $3`,
                    [review.id, requestingUserId, tenantId]
                );
                review.user_has_voted = voteRes.rows.length > 0;
            } else {
                review.user_has_voted = false;
            }

            // Is this the requesting user's own review?
            review.is_own = requestingUserId ? review.user_id === requestingUserId : false;
        }

        // Total count
        const countRes = await query(`
            SELECT COUNT(*) AS total FROM product_reviews
            WHERE product_id = $1 AND tenant_id = $2 AND status = 'published' AND deleted_at IS NULL
        `, [productId, tenantId]);

        // Is the requesting user the product owner? (for reply button visibility)
        const isRequestingUserOwner = requestingUserId && productOwnerId
            ? requestingUserId === productOwnerId
            : false;

        return {
            reviews,
            product_owner_id: productOwnerId,
            is_product_owner: isRequestingUserOwner,
            pagination: {
                page,
                perPage,
                total: parseInt(countRes.rows[0].total),
                totalPages: Math.ceil(parseInt(countRes.rows[0].total) / perPage)
            }
        };
    }
}

module.exports = ReviewService;
