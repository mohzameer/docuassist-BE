// src/utils/common.js

/**
 * Generates a timestamp-based ID with optional prefix
 * @param {string} prefix - Optional prefix for the ID
 * @returns {string} Generated ID
 */
export const generateTimeBasedId = (prefix = '') => {
    const timestamp = new Date().getTime();
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `${prefix}${timestamp}${random}`;
};

/**
 * Gets current ISO timestamp
 * @returns {string} ISO timestamp
 */
export const getCurrentTimestamp = () => {
    return new Date().toISOString();
};

/**
 * Validates required fields in an object
 * @param {Object} data - Object to validate
 * @param {Array<string>} requiredFields - Array of required field names
 * @returns {Object} Validation result
 */
export const validateRequiredFields = (data, requiredFields) => {
    const missingFields = requiredFields.filter(field => !data[field]);
    if (missingFields.length > 0) {
        return {
            isValid: false,
            message: `Missing required fields: ${missingFields.join(', ')}`
        };
    }
    return { isValid: true };
};

/**
 * Builds DynamoDB query parameters for pagination
 * @param {Object} event - API Gateway event object
 * @param {Object} baseParams - Base DynamoDB query parameters
 * @returns {Object} Updated query parameters with pagination
 */
export const buildPaginationParams = (event, baseParams) => {
    const { nextToken, limit } = event.queryStringParameters || {};

    if (nextToken) {
        baseParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    }

    if (limit) {
        baseParams.Limit = parseInt(limit, 10);
    }

    return baseParams;
};

/**
 * Formats pagination response
 * @param {Object} result - DynamoDB query result
 * @returns {Object} Formatted response with items and pagination token
 */
export const formatPaginatedResponse = (result) => {
    const response = {
        items: result.Items
    };

    if (result.LastEvaluatedKey) {
        response.nextToken = Buffer.from(
            JSON.stringify(result.LastEvaluatedKey)
        ).toString('base64');
    }

    return response;
};

/**
 * Builds DynamoDB filter expression and attribute values
 * @param {Object} filters - Filter criteria
 * @returns {Object} DynamoDB filter expression and values
 */
export const buildFilterExpression = (filters) => {
    const expression = [];
    const expressionAttributes = {};
    const expressionValues = {};

    Object.entries(filters).forEach(([key, value], index) => {
        if (value !== undefined && value !== null) {
            const attrName = `#attr${index}`;
            const attrValue = `:val${index}`;

            expression.push(`${attrName} = ${attrValue}`);
            expressionAttributes[attrName] = key;
            expressionValues[attrValue] = value;
        }
    });

    return {
        FilterExpression: expression.length ? expression.join(' AND ') : undefined,
        ExpressionAttributeNames: Object.keys(expressionAttributes).length ? expressionAttributes : undefined,
        ExpressionAttributeValues: Object.keys(expressionValues).length ? expressionValues : undefined
    };
};

/**
 * Formats error details for consistent error responses
 * @param {Error} error - Error object
 * @param {string} context - Error context
 * @returns {Object} Formatted error details
 */
export const formatErrorDetails = (error, context) => {
    return {
        message: error.message,
        code: error.code || 'INTERNAL_ERROR',
        context,
        timestamp: getCurrentTimestamp(),
        details: error.details || {}
    };
};

/**
 * Sanitizes object by removing undefined and null values
 * @param {Object} obj - Object to sanitize
 * @returns {Object} Sanitized object
 */
export const sanitizeObject = (obj) => {
    return Object.entries(obj).reduce((acc, [key, value]) => {
        if (value !== undefined && value !== null) {
            acc[key] = value;
        }
        return acc;
    }, {});
};

/**
 * Generates a sortable timestamp for consistent ordering
 * @param {Date} [date] - Optional date object
 * @returns {string} Sortable timestamp
 */
export const generateSortableTimestamp = (date = new Date()) => {
    return date.toISOString().replace(/[-:.]/g, '');
};

/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} Validation result
 */
export const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * Chunks array into smaller arrays
 * @param {Array} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {Array} Array of chunks
 */
export const chunkArray = (array, size) => {
    return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
        array.slice(index * size, (index + 1) * size)
    );
};

/**
 * Generates a random alphanumeric string of a given length
 * @param {number} length - Length of the generated string
 * @returns {string} Generated random string
 */
export const generateRandomString = (length) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};