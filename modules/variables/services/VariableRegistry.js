/**
 * VariableRegistry
 * 
 * Central registry for dynamic variables that can be resolved at runtime.
 * Modules register variables with a name, description, and a resolver function.
 * The resolver receives a context object (tenantId, userId, etc.) and returns
 * the resolved string value.
 * 
 * Example usage from another module:
 *   eventBus.emitEvent('variable.register', {
 *       name: 'BUSINESS_NAME',
 *       description: 'The business name of the current vendor',
 *       resolver: async (context) => { ... return 'Acme Corp'; }
 *   });
 * 
 * Then to resolve:
 *   const value = await VariableRegistry.resolve('BUSINESS_NAME', { tenantId, userId });
 *   // => 'Acme Corp'
 * 
 *   const text = await VariableRegistry.resolveText('Store: [BUSINESS_NAME]', { tenantId, userId });
 *   // => 'Store: Acme Corp'
 */

class VariableRegistry {
    constructor() {
        /** @type {Map<string, { description: string, resolver: Function }>} */
        this.variables = new Map();
    }

    /**
     * Register a variable.
     * @param {string} name - Variable name (e.g. 'BUSINESS_NAME'). Stored uppercase.
     * @param {string} description - Human-readable description.
     * @param {Function} resolver - async (context) => string. Called to resolve the value.
     */
    register(name, description, resolver) {
        const key = name.toUpperCase();
        if (this.variables.has(key)) {
            console.log(`[VariableRegistry] Overwriting existing variable: ${key}`);
        }
        this.variables.set(key, { description, resolver });
        console.log(`[VariableRegistry] Registered variable: [${key}]`);
    }

    /**
     * Unregister a variable.
     * @param {string} name 
     */
    unregister(name) {
        this.variables.delete(name.toUpperCase());
    }

    /**
     * Check if a variable is registered.
     * @param {string} name 
     * @returns {boolean}
     */
    has(name) {
        return this.variables.has(name.toUpperCase());
    }

    /**
     * Get all registered variable names and descriptions.
     * @returns {Array<{ name: string, description: string }>}
     */
    list() {
        const result = [];
        for (const [name, { description }] of this.variables) {
            result.push({ name, description });
        }
        return result;
    }

    /**
     * Resolve a single variable by name.
     * @param {string} name - Variable name (e.g. 'BUSINESS_NAME')
     * @param {object} context - Context for resolution (tenantId, userId, etc.)
     * @returns {Promise<string|null>} Resolved value, or null if not found.
     */
    async resolve(name, context = {}) {
        const key = name.toUpperCase();
        const entry = this.variables.get(key);
        if (!entry) {
            console.warn(`[VariableRegistry] Unknown variable: [${key}]`);
            return null;
        }

        try {
            const value = await entry.resolver(context);
            return value;
        } catch (error) {
            console.error(`[VariableRegistry] Error resolving [${key}]:`, error);
            return null;
        }
    }

    /**
     * Resolve all [VARIABLE_NAME] placeholders in a text string.
     * @param {string} text - Text containing [VARIABLE] placeholders.
     * @param {object} context - Context for resolution.
     * @returns {Promise<string>} Text with all variables resolved.
     */
    async resolveText(text, context = {}) {
        if (!text || typeof text !== 'string') return text;

        // Match all [VARIABLE_NAME] patterns
        const pattern = /\[([A-Z_][A-Z0-9_]*)\]/g;
        const matches = [...text.matchAll(pattern)];

        if (matches.length === 0) return text;

        let result = text;
        // Resolve all variables in parallel
        const resolutions = await Promise.all(
            matches.map(async (match) => {
                const varName = match[1];
                const value = await this.resolve(varName, context);
                return { placeholder: match[0], value };
            })
        );

        for (const { placeholder, value } of resolutions) {
            if (value !== null) {
                result = result.replaceAll(placeholder, value);
            }
        }

        return result;
    }
}

// Singleton instance
module.exports = new VariableRegistry();
