// src/lib/response.js
const buildResponse = (statusCode, body) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Amzn-Trace-Id,X-Access-Token',
        'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE'
    },
    body: JSON.stringify(body)
});

export const success = (body) => buildResponse(200, body);

export const error = (err) => buildResponse(err.statusCode || 500, { error: err.message });

export const notFound = (message) => buildResponse(404, { error: message });