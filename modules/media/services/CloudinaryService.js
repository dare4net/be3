const cloudinary = require('cloudinary').v2;
const fs = require('fs');

class CloudinaryService {
    constructor() {
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET
        });
    }

    /**
     * Upload a file to Cloudinary
     * @param {string} filePath - Local path to the file
     * @param {string} folder - Destination folder on Cloudinary (e.g. 'products', 'categories')
     * @param {Object} options - Additional Cloudinary options
     */
    async uploadImage(filePath, folder = 'general', options = {}) {
        try {
            const result = await cloudinary.uploader.upload(filePath, {
                folder: `be3/${folder}`,
                use_filename: true,
                unique_filename: true,
                overwrite: false,
                resource_type: 'auto',
                transformation: [
                    { quality: 'auto', fetch_format: 'auto' }
                ],
                ...options
            });

            // Clean up local temp file after upload (if it's a local file path)
            const isLocalFile = !filePath.startsWith('http') && !filePath.startsWith('data:');
            if (isLocalFile && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            return {
                url: result.secure_url,
                publicId: result.public_id,
                width: result.width,
                height: result.height,
                format: result.format
            };
        } catch (error) {
            console.error('[CloudinaryService] Upload failed:', error);
            // Still try to clean up if upload fails (if it's a local file path)
            const isLocalFile = !filePath.startsWith('http') && !filePath.startsWith('data:');
            if (isLocalFile && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            throw new Error(`Image upload failed: ${error.message}`);
        }
    }

    /**
     * Delete an image from Cloudinary
     * @param {string} publicId - The public ID of the image
     */
    async deleteImage(publicId) {
        try {
            await cloudinary.uploader.destroy(publicId);
            return true;
        } catch (error) {
            console.error('[CloudinaryService] Deletion failed:', error);
            return false;
        }
    }

    /**
     * Mirror an external image to Cloudinary if it's not already there
     * @param {string} url - The URL to check and mirror
     * @param {string} folder - Destination folder
     * @param {string} oldUrl - Optional old URL to delete if mirroring succeeds
     * @returns {Promise<string>} - The Cloudinary URL or the original if no change
     */
    async mirrorExternalImage(url, folder = 'general', oldUrl = null) {
        if (!url || url.includes('cloudinary.com')) return url;
        
        // Only mirror if it's an external http link or a data URI (base64)
        const isExternal = url.startsWith('http');
        const isDataUri = url.startsWith('data:');
        
        if (!isExternal && !isDataUri) return url;

        try {
            console.log(`[Cloudinary] Mirroring external asset: ${url}`);
            const result = await this.uploadImage(url, folder);
            
            // If we have an old Cloudinary asset, clean it up
            if (oldUrl && oldUrl.includes('cloudinary.com')) {
                await this.deleteImageByUrl(oldUrl);
            }

            return result.url;
        } catch (error) {
            console.error('[Cloudinary] Mirroring failed, falling back to raw URL:', error.message);
            return url; // Fallback to original URL if upload fails
        }
    }

    /**
     * Delete an image using its Cloudinary URL
     * @param {string} url - The full Cloudinary URL
     */
    async deleteImageByUrl(url) {
        if (!url || !url.includes('cloudinary.com')) return false;

        try {
            // Extract public ID from URL
            // Format: .../upload/v1234567/public_id.jpg
            const parts = url.split('/');
            const uploadIndex = parts.indexOf('upload');
            if (uploadIndex === -1) return false;

            // Everything after 'v[version]/' and before the extension
            let publicIdPath = parts.slice(uploadIndex + 2).join('/');
            const lastDotIndex = publicIdPath.lastIndexOf('.');
            const publicId = lastDotIndex !== -1 ? publicIdPath.substring(0, lastDotIndex) : publicIdPath;

            return await this.deleteImage(publicId);
        } catch (error) {
            console.error('[CloudinaryService] Delete by URL failed:', error);
            return false;
        }
    }
}

module.exports = new CloudinaryService();
