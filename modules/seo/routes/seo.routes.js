const express = require('express');
const router = express.Router();
const SeoController = require('../controllers/SeoController');

// Public route to get the sitemap (returns XML)
router.get('/sitemap.xml', SeoController.getSitemap);

// Public route to get SEO presets for the tenant
router.get('/presets', SeoController.getPresets);

// MOCKED: Admin route to update SEO presets (requires auth and permissions in the future)
router.post('/presets', SeoController.updatePresets);

module.exports = router;
