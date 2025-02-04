// src/middleware/auth.js
import { CognitoJwtVerifier } from "aws-jwt-verify";

// Create verifiers once, not on every request
const idTokenVerifier = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    clientId: process.env.COGNITO_CLIENT_ID,
    tokenUse: "id",
});

const accessTokenVerifier = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    clientId: process.env.COGNITO_CLIENT_ID,
    tokenUse: "access",
});

const auth = async (event) => {
    try {
        // Extract tokens and tenant ID
        const idToken = event.headers.Authorization?.replace('Bearer ', '');
        const accessToken = event.headers['x-access-token']?.replace('Bearer ', '');
        const tenantId = event.headers['x-tenant-id'];

        // Early validation of required fields
        if (!idToken || !accessToken || !tenantId) {
            return createUnauthorizedResponse('Missing required authentication headers');
        }

        // Verify both tokens concurrently for better performance
        const [idPayload, accessPayload] = await Promise.all([
            idTokenVerifier.verify(idToken).catch(error => {
                console.error('ID Token verification failed:', error);
                throw new Error('Invalid ID token');
            }),
            accessTokenVerifier.verify(accessToken).catch(error => {
                console.error('Access Token verification failed:', error);
                throw new Error('Invalid access token');
            })
        ]);

        // Verify token subjects match (additional security check)
        if (idPayload.sub !== accessPayload.sub) {
            return createUnauthorizedResponse('Token mismatch');
        }

        // Return user context
        return {
            userId: idPayload.sub,
            email: idPayload.email,
            tenantId,
            givenName: idPayload.given_name,
            familyName: idPayload.family_name
        };

    } catch (error) {
        console.error('Authentication error:', error);
        return createUnauthorizedResponse('Authentication failed');
    }
};

// Helper function for consistent error responses
const createUnauthorizedResponse = (message) => ({
    statusCode: 401,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true
    },
    body: JSON.stringify({ error: message })
});

export default auth;
export { idTokenVerifier, accessTokenVerifier };