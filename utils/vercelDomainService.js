/**
 * Vercel Domain API Service
 * 
 * Interacts with Vercel REST API to automatically add, verify, and remove
 * custom tenant domains on your Vercel Storefront project.
 */

const axios = require('axios');

class VercelDomainService {
    static get config() {
        return {
            token: process.env.VERCEL_API_TOKEN,
            projectId: process.env.VERCEL_PROJECT_ID || process.env.VERCEL_STOREFRONT_PROJECT_ID,
            teamId: process.env.VERCEL_TEAM_ID,
        };
    }

    /**
     * Check if Vercel API credentials are configured
     */
    static isConfigured() {
        return Boolean(this.config.token && this.config.projectId);
    }

    /**
     * Add custom domain to Vercel storefront project
     */
    static async addDomainToProject(domain) {
        if (!this.isConfigured()) {
            console.warn('[VercelAPI] VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set. Skipping Vercel domain registration.');
            return { success: false, skipped: true, message: 'Vercel API token or project ID not configured in environment variables.' };
        }

        const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        let url = `https://api.vercel.com/v10/projects/${this.config.projectId}/domains`;
        if (this.config.teamId) {
            url += `?teamId=${this.config.teamId}`;
        }

        try {
            const response = await axios.post(
                url,
                { name: cleanDomain },
                {
                    headers: {
                        Authorization: `Bearer ${this.config.token}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            console.log(`[VercelAPI] Successfully registered ${cleanDomain} on Vercel project ${this.config.projectId}`);
            return {
                success: true,
                domain: response.data.name,
                apexName: response.data.apexName,
                verified: response.data.verified,
                verification: response.data.verification,
            };
        } catch (error) {
            const errorMsg = error.response?.data?.error?.message || error.message;
            console.error(`[VercelAPI] Failed to add domain ${cleanDomain}:`, errorMsg);
            return {
                success: false,
                error: errorMsg,
                code: error.response?.data?.error?.code,
            };
        }
    }

    /**
     * Remove domain from Vercel storefront project
     */
    static async removeDomainFromProject(domain) {
        if (!this.isConfigured() || !domain) return { success: false, skipped: true };

        const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        let url = `https://api.vercel.com/v9/projects/${this.config.projectId}/domains/${cleanDomain}`;
        if (this.config.teamId) {
            url += `?teamId=${this.config.teamId}`;
        }

        try {
            await axios.delete(url, {
                headers: {
                    Authorization: `Bearer ${this.config.token}`,
                },
            });
            console.log(`[VercelAPI] Removed ${cleanDomain} from Vercel project`);
            return { success: true };
        } catch (error) {
            console.error(`[VercelAPI] Failed to remove domain ${cleanDomain}:`, error.response?.data || error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verify domain configuration status on Vercel
     */
    static async verifyDomainOnVercel(domain) {
        if (!this.isConfigured()) return null;

        const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        let url = `https://api.vercel.com/v9/projects/${this.config.projectId}/domains/${cleanDomain}/verify`;
        if (this.config.teamId) {
            url += `?teamId=${this.config.teamId}`;
        }

        try {
            const response = await axios.post(
                url,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${this.config.token}`,
                    },
                }
            );
            return {
                success: true,
                verified: response.data.verified,
                verification: response.data.verification,
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error?.message || error.message,
            };
        }
    }
}

module.exports = VercelDomainService;
