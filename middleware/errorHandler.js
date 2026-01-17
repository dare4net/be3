/**
 * Global Error Handler Middleware
 * Provides consistent error responses across all modules
 */

function errorHandler(err, req, res, next) {
    // Log error
    console.error('[Error]', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        tenantId: req.tenantId,
    });

    // Default to 500 server error
    const statusCode = err.statusCode || err.status || 500;

    // Prepare error response
    const errorResponse = {
        error: err.name || 'ServerError',
        message: err.message || 'An unexpected error occurred',
    };

    // Add validation errors if present
    if (err.details) {
        errorResponse.details = err.details;
    }

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = err.stack;
    }

    res.status(statusCode).json(errorResponse);
}

/**
 * 404 Handler for undefined routes
 */
function notFoundHandler(req, res) {
    res.status(404).json({
        error: 'NotFound',
        message: `Route ${req.method} ${req.path} not found`,
    });
}

/**
 * Async wrapper to catch errors in async route handlers
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler,
};
