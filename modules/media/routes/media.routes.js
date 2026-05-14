const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const CloudinaryService = require('../services/CloudinaryService');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../../middleware/errorHandler');

// ─── Image upload (5 MB) ──────────────────────────────────────────────────────
const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => {
        const suffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + suffix + path.extname(file.originalname));
    }
});

const uploadImage = multer({
    storage: imageStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp|gif/;
        if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
            return cb(null, true);
        }
        cb(new Error('Only image files (jpg, jpeg, png, webp, gif) are allowed!'));
    }
});

// ─── Document upload (10 MB) — images OR PDF, used for KYC/KYB docs ─────────
const documentStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => {
        const suffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'doc-' + suffix + path.extname(file.originalname));
    }
});

const uploadDocument = multer({
    storage: documentStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
        const allowedExts  = /jpeg|jpg|png|webp|pdf/;
        if (allowedMimes.includes(file.mimetype) && allowedExts.test(path.extname(file.originalname).toLowerCase())) {
            return cb(null, true);
        }
        cb(new Error('Only image files (jpg, png, webp) or PDF documents are allowed!'));
    }
});

// ─── Video upload (50 MB) — used for KYC liveness check ──────────────────────
const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => {
        const suffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'video-' + suffix + path.extname(file.originalname));
    }
});

const uploadVideo = multer({
    storage: videoStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['video/mp4', 'video/quicktime', 'video/webm'];
        const allowedExts = /mp4|mov|webm/;
        if (allowedMimes.includes(file.mimetype) && allowedExts.test(path.extname(file.originalname).toLowerCase())) {
            return cb(null, true);
        }
        cb(new Error('Only video files (mp4, mov, webm) are allowed for liveness upload!'));
    }
});

function registerMediaRoutes(router) {
    /**
     * Upload an image to Cloudinary
     * POST /media/upload
     * Body: multipart/form-data with 'file' and optional 'folder'
     */
    router.post('/upload', authenticate, uploadImage.single('file'), asyncHandler(async (req, res) => {
        const { folder, url } = req.body;
        const targetFolder = folder || 'general';

        try {
            let result;

            if (req.file) {
                console.log(`[Media] Uploading image to Cloudinary folder: be3/${targetFolder}`);
                result = await CloudinaryService.uploadImage(req.file.path, targetFolder);
            } else if (url) {
                console.log(`[Media] Mirroring remote URL to Cloudinary folder: be3/${targetFolder}`);
                result = await CloudinaryService.uploadImage(url, targetFolder);
            } else {
                return res.status(400).json({ error: 'Either file or url must be provided' });
            }

            res.json({
                success: true,
                url: result.url,
                publicId: result.publicId,
                metadata: {
                    width: result.width,
                    height: result.height,
                    format: result.format
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }));

    /**
     * Upload a liveness video to Cloudinary
     * POST /media/upload-video
     * Body: multipart/form-data with 'file' (mp4 / mov / webm, max 50 MB)
     * Returns: { success, url, publicId, duration }
     */
    router.post('/upload-video', authenticate, uploadVideo.single('file'), asyncHandler(async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'A video file is required' });
        }

        try {
            console.log(`[Media] Uploading liveness video to Cloudinary folder: be3/kyc/liveness`);
            const result = await CloudinaryService.uploadVideo(req.file.path, 'kyc/liveness');

            res.json({
                success: true,
                url: result.url,
                publicId: result.publicId,
                duration: result.duration || null,
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }));

    /**
     * Upload a KYC/KYB document (image or PDF)
     * POST /media/upload-document
     * Body: multipart/form-data with 'file' (jpg, png, webp, pdf — max 10 MB)
     * Returns: { success, url, publicId }
     */
    router.post('/upload-document', authenticate, uploadDocument.single('file'), asyncHandler(async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'A document file is required' });
        }

        try {
            const isPdf = req.file.mimetype === 'application/pdf';
            console.log(`[Media] Uploading KYC document (${isPdf ? 'PDF' : 'image'}) to Cloudinary`);
            const result = await CloudinaryService.uploadDocument(req.file.path, 'kyc/documents', isPdf);

            res.json({
                success: true,
                url: result.url,
                publicId: result.publicId,
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }));

    /**
     * Delete an image from Cloudinary
     * DELETE /media/delete?url=...
     */
    router.delete('/delete', authenticate, asyncHandler(async (req, res) => {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const success = await CloudinaryService.deleteImageByUrl(url);
        res.json({ success });
    }));
}

module.exports = { registerMediaRoutes };
