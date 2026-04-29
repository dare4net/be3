/**
 * Reviews Authenticated Routes
 * Rating CRUD, Review CRUD, Helpful Votes, Vendor Replies
 */

const { query } = require('../../../config/database');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../../middleware/errorHandler');
const ReviewService = require('../services/ReviewService');

function registerReviewRoutes(router) {

    // ==========================================
    // RATINGS (One per user per product)
    // ==========================================

    // Get my rating for a product
    router.get('/ratings/:productId/mine', authenticate, asyncHandler(async (req, res) => {
        const result = await query(
            `SELECT * FROM product_ratings WHERE tenant_id = $1 AND product_id = $2 AND user_id = $3`,
            [req.tenantId, req.params.productId, req.user.id]
        );
        res.json({ success: true, rating: result.rows[0] || null });
    }));

    // Set/update my rating (upsert) — verified buyers only
    router.put('/ratings/:productId', authenticate, asyncHandler(async (req, res) => {
        const { productId } = req.params;
        const { rating } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        // Check verified buyer
        const isVerified = await ReviewService.isVerifiedBuyer(req.tenantId, req.user.id, productId);
        if (!isVerified) {
            return res.status(403).json({ 
                error: 'Only verified buyers can rate products',
                message: 'You must purchase this product before you can rate it.'
            });
        }

        const result = await query(`
            INSERT INTO product_ratings (tenant_id, product_id, user_id, rating)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tenant_id, product_id, user_id)
            DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()
            RETURNING *
        `, [req.tenantId, productId, req.user.id, rating]);

        // Recalculate summary
        await ReviewService.recalculateSummary(req.tenantId, productId);

        res.json({ success: true, rating: result.rows[0] });
    }));

    // Delete my rating
    router.delete('/ratings/:productId', authenticate, asyncHandler(async (req, res) => {
        await query(
            `DELETE FROM product_ratings WHERE tenant_id = $1 AND product_id = $2 AND user_id = $3`,
            [req.tenantId, req.params.productId, req.user.id]
        );

        await ReviewService.recalculateSummary(req.tenantId, req.params.productId);
        res.json({ success: true, message: 'Rating removed' });
    }));

    // ==========================================
    // REVIEWS (Many per user per product)
    // ==========================================

    // Create a review — any authenticated user
    router.post('/:productId', authenticate, asyncHandler(async (req, res) => {
        const { productId } = req.params;
        const { title, body, media_urls } = req.body;

        if (!body || body.trim().length === 0) {
            return res.status(400).json({ error: 'Review body is required' });
        }

        // Check verified purchase status
        const isVerified = await ReviewService.isVerifiedBuyer(req.tenantId, req.user.id, productId);

        const result = await query(`
            INSERT INTO product_reviews (tenant_id, product_id, user_id, title, body, is_verified_purchase)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [req.tenantId, productId, req.user.id, title || null, body.trim(), isVerified]);

        const review = result.rows[0];

        // Handle media (max 4)
        if (media_urls && Array.isArray(media_urls)) {
            const urls = media_urls.slice(0, 4);
            for (let i = 0; i < urls.length; i++) {
                await query(`
                    INSERT INTO review_media (tenant_id, review_id, url, position)
                    VALUES ($1, $2, $3, $4)
                `, [req.tenantId, review.id, urls[i], i]);
            }
        }

        // Recalculate summary (review count changed)
        await ReviewService.recalculateSummary(req.tenantId, productId);

        res.status(201).json({ success: true, review });
    }));

    // Edit own review
    router.patch('/:reviewId', authenticate, asyncHandler(async (req, res) => {
        const { reviewId } = req.params;
        const { title, body, media_urls } = req.body;

        // Verify ownership
        const existing = await query(
            `SELECT * FROM product_reviews WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
            [reviewId, req.tenantId, req.user.id]
        );
        if (!existing.rows[0]) {
            return res.status(404).json({ error: 'Review not found or access denied' });
        }

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (body !== undefined) {
            if (!body || body.trim().length === 0) {
                return res.status(400).json({ error: 'Review body cannot be empty' });
            }
            updates.body = body.trim();
        }

        if (Object.keys(updates).length > 0) {
            const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`);
            setClauses.push('updated_at = NOW()');
            const values = Object.values(updates);

            await query(
                `UPDATE product_reviews SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2`,
                [reviewId, req.tenantId, ...values]
            );
        }

        // Replace media if provided
        if (media_urls && Array.isArray(media_urls)) {
            await query(`DELETE FROM review_media WHERE review_id = $1 AND tenant_id = $2`, [reviewId, req.tenantId]);
            const urls = media_urls.slice(0, 4);
            for (let i = 0; i < urls.length; i++) {
                await query(`
                    INSERT INTO review_media (tenant_id, review_id, url, position)
                    VALUES ($1, $2, $3, $4)
                `, [req.tenantId, reviewId, urls[i], i]);
            }
        }

        const updated = await query(`SELECT * FROM product_reviews WHERE id = $1`, [reviewId]);
        res.json({ success: true, review: updated.rows[0] });
    }));

    // Delete own review (soft delete)
    router.delete('/:reviewId', authenticate, asyncHandler(async (req, res) => {
        const existing = await query(
            `SELECT product_id FROM product_reviews WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL`,
            [req.params.reviewId, req.tenantId, req.user.id]
        );
        if (!existing.rows[0]) {
            return res.status(404).json({ error: 'Review not found or access denied' });
        }

        await query(
            `UPDATE product_reviews SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2`,
            [req.params.reviewId, req.tenantId]
        );

        // Recalculate summary
        await ReviewService.recalculateSummary(req.tenantId, existing.rows[0].product_id);

        res.json({ success: true, message: 'Review deleted' });
    }));

    // Get my reviews for a product
    router.get('/mine/:productId', authenticate, asyncHandler(async (req, res) => {
        const result = await query(`
            SELECT r.*, 
                   pr.rating AS author_rating
            FROM product_reviews r
            LEFT JOIN product_ratings pr ON pr.user_id = r.user_id 
                AND pr.product_id = r.product_id AND pr.tenant_id = r.tenant_id
            WHERE r.tenant_id = $1 AND r.product_id = $2 AND r.user_id = $3 AND r.deleted_at IS NULL
            ORDER BY r.created_at DESC
        `, [req.tenantId, req.params.productId, req.user.id]);

        // Get media for each
        for (const review of result.rows) {
            const mediaRes = await query(
                `SELECT id, url, media_type, position FROM review_media WHERE review_id = $1 ORDER BY position ASC`,
                [review.id]
            );
            review.media = mediaRes.rows;
        }

        res.json({ success: true, reviews: result.rows });
    }));

    // ==========================================
    // HELPFUL VOTES (Toggle)
    // ==========================================

    router.post('/:reviewId/vote', authenticate, asyncHandler(async (req, res) => {
        const { reviewId } = req.params;

        // Check if already voted
        const existing = await query(
            `SELECT id FROM review_votes WHERE review_id = $1 AND user_id = $2 AND tenant_id = $3`,
            [reviewId, req.user.id, req.tenantId]
        );

        if (existing.rows.length > 0) {
            // Remove vote (toggle off)
            await query(`DELETE FROM review_votes WHERE id = $1`, [existing.rows[0].id]);
            res.json({ success: true, voted: false, message: 'Vote removed' });
        } else {
            // Add vote (toggle on)
            await query(`
                INSERT INTO review_votes (tenant_id, review_id, user_id) VALUES ($1, $2, $3)
            `, [req.tenantId, reviewId, req.user.id]);
            res.json({ success: true, voted: true, message: 'Vote added' });
        }
    }));

    // ==========================================
    // VENDOR REPLIES (One per vendor per review)
    // ==========================================

    // Post/update vendor reply — only product owner (via created_by)
    router.post('/:reviewId/reply', authenticate, asyncHandler(async (req, res) => {
        const { reviewId } = req.params;
        const { body } = req.body;

        if (!body || body.trim().length === 0) {
            return res.status(400).json({ error: 'Reply body is required' });
        }

        // Get the review's product to check ownership
        const reviewRes = await query(
            `SELECT product_id FROM product_reviews WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
            [reviewId, req.tenantId]
        );
        if (!reviewRes.rows[0]) {
            return res.status(404).json({ error: 'Review not found' });
        }

        // Check if user owns the product (via created_by)
        const isOwner = await ReviewService.isProductOwner(req.tenantId, req.user.id, reviewRes.rows[0].product_id);
        if (!isOwner) {
            return res.status(403).json({ error: 'Only the product vendor can reply to reviews' });
        }

        const result = await query(`
            INSERT INTO review_replies (tenant_id, review_id, vendor_id, body)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tenant_id, review_id, vendor_id)
            DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()
            RETURNING *
        `, [req.tenantId, reviewId, req.user.id, body.trim()]);

        res.json({ success: true, reply: result.rows[0] });
    }));

    // Edit vendor reply
    router.patch('/replies/:replyId', authenticate, asyncHandler(async (req, res) => {
        const { body } = req.body;
        if (!body || body.trim().length === 0) {
            return res.status(400).json({ error: 'Reply body is required' });
        }

        const result = await query(`
            UPDATE review_replies SET body = $1, updated_at = NOW()
            WHERE id = $2 AND tenant_id = $3 AND vendor_id = $4
            RETURNING *
        `, [body.trim(), req.params.replyId, req.tenantId, req.user.id]);

        if (!result.rows[0]) {
            return res.status(404).json({ error: 'Reply not found or access denied' });
        }

        res.json({ success: true, reply: result.rows[0] });
    }));

    // Delete vendor reply
    router.delete('/replies/:replyId', authenticate, asyncHandler(async (req, res) => {
        const result = await query(
            `DELETE FROM review_replies WHERE id = $1 AND tenant_id = $2 AND vendor_id = $3 RETURNING id`,
            [req.params.replyId, req.tenantId, req.user.id]
        );

        if (!result.rows[0]) {
            return res.status(404).json({ error: 'Reply not found or access denied' });
        }

        res.json({ success: true, message: 'Reply deleted' });
    }));
}

module.exports = { registerReviewRoutes };
