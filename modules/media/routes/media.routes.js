const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const CloudinaryService = require('../services/CloudinaryService');
const { authenticate } = require('../../../platform/core/auth/middleware/authenticate');
const { asyncHandler } = require('../../../middleware/errorHandler');

// Configure Multer for local temporary storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, os.tmpdir());
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files (jpg, jpeg, png, webp, gif) are allowed!'));
    }
});

function registerMediaRoutes(router) {
    /**
     * Upload an image to Cloudinary
     * POST /media/upload
     * Body: multipart/form-data with 'file' and 'folder'
     */
    router.post('/upload', authenticate, upload.single('file'), asyncHandler(async (req, res) => {
        const { folder, url } = req.body;
        const targetFolder = folder || 'general';

        try {
            let result;

            if (req.file) {
                // Upload physical file from Buffer
                console.log(`[Media] Uploading physical file to Cloudinary folder: be3/${targetFolder}`);
                result = await CloudinaryService.uploadImage(req.file.path, targetFolder);
            } else if (url) {
                // Mirror remote URL to Cloudinary
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
