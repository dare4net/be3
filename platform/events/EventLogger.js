const { query } = require('../../config/database');
const eventBus = require('./EventBus');

/**
 * Event Logger - Persists events to database
 * Provides audit trail and debugging capabilities
 */
class EventLogger {
    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize event logger by listening to all events
     */
    async initialize() {
        if (this.initialized) return;

        // Listen to all events via wildcard
        eventBus.on('*', async (event) => {
            await this.logEvent(event);
        });

        this.initialized = true;
        console.log('✓ Event Logger initialized');
    }

    /**
     * Log event to database
     */
    async logEvent(event) {
        // Prevent frontend analytics from contaminating the backend system audit trail
        if (event.name && event.name.startsWith('analytics.')) {
            return;
        }

        try {
            const sql = `
        INSERT INTO event_logs (
          event_name,
          event_data,
          tenant_id,
          created_at
        ) VALUES ($1, $2, $3, $4)
      `;

            await query(sql, [
                event.name,
                JSON.stringify(event.data),
                event.tenantId || null,
                event.timestamp
            ]);

            // Log to console if enabled
            if (process.env.ENABLE_EVENT_LOGS === 'true') {
                console.log(`[Event] ${event.name} (Tenant: ${event.tenantId || 'system'})`);
            }
        } catch (error) {
            // Don't throw - logging shouldn't break the app
            console.error('[EventLogger] Failed to log event:', error.message);
        }
    }

    /**
     * Query event logs
     */
    async getEvents(filters = {}, limit = 100) {
        let sql = 'SELECT * FROM event_logs WHERE 1=1';
        const params = [];
        let paramCount = 1;

        if (filters.tenantId) {
            sql += ` AND tenant_id = $${paramCount}`;
            params.push(filters.tenantId);
            paramCount++;
        }

        if (filters.eventName) {
            sql += ` AND event_name = $${paramCount}`;
            params.push(filters.eventName);
            paramCount++;
        }

        if (filters.startDate) {
            sql += ` AND created_at >= $${paramCount}`;
            params.push(filters.startDate);
            paramCount++;
        }

        if (filters.endDate) {
            sql += ` AND created_at <= $${paramCount}`;
            params.push(filters.endDate);
            paramCount++;
        }

        sql += ` ORDER BY created_at DESC LIMIT $${paramCount}`;
        params.push(limit);

        const result = await query(sql, params);
        return result.rows;
    }
}

const eventLogger = new EventLogger();

module.exports = eventLogger;
