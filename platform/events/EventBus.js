const EventEmitter = require('events');

/**
 * Global Event Bus for inter-module communication
 * 
 * PRINCIPLE: All inter-module communication is event-based
 * PRINCIPLE: Modules do not import other modules
 * 
 * This is the ONLY way modules communicate with each other.
 * No module should ever require() another module's code.
 */
class EventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50); // Allow many modules to listen
        this.eventLog = [];
        this.maxLogSize = 1000;
    }

    /**
     * Emit an event with automatic logging
     * @param {string} eventName - Event name (e.g., 'product.created')
     * @param {Object} data - Event data
     */
    emitEvent(eventName, data) {
        const event = {
            name: eventName,
            data,
            timestamp: new Date().toISOString(),
            tenantId: data.tenantId || null,
        };

        // Log the event
        this._logEvent(event);

        // Emit to all listeners
        this.emit(eventName, event);

        // Also emit to a wildcard listener for monitoring
        this.emit('*', event);

        return event;
    }

    /**
     * Register event listener with metadata
     * @param {string} eventName - Event to listen for
     * @param {Function} handler - Handler function
     * @param {string} moduleName - Name of the module registering the listener
     */
    registerListener(eventName, handler, moduleName = 'unknown') {
        const wrappedHandler = async (event) => {
            try {
                await handler(event);
            } catch (error) {
                console.error(`[EventBus] Error in ${moduleName} handling ${eventName}:`, error);
                // Don't throw - we don't want one module's error to crash others
                // PRINCIPLE: Any module can be removed without crashing the system
            }
        };

        this.on(eventName, wrappedHandler);
        console.log(`[EventBus] ${moduleName} registered listener for '${eventName}'`);
    }

    /**
     * Log event for debugging and audit trail
     */
    _logEvent(event) {
        this.eventLog.push(event);

        // Keep log size manageable
        if (this.eventLog.length > this.maxLogSize) {
            this.eventLog.shift();
        }
    }

    /**
     * Get recent events (for debugging)
     */
    getRecentEvents(limit = 50) {
        return this.eventLog.slice(-limit);
    }

    /**
     * Get events by name
     */
    getEventsByName(eventName, limit = 50) {
        return this.eventLog
            .filter(e => e.name === eventName)
            .slice(-limit);
    }

    /**
     * Get events by tenant
     */
    getEventsByTenant(tenantId, limit = 50) {
        return this.eventLog
            .filter(e => e.tenantId === tenantId)
            .slice(-limit);
    }

    /**
     * Clear event log
     */
    clearLog() {
        this.eventLog = [];
    }
}

// Singleton instance
const eventBus = new EventBus();

module.exports = eventBus;
