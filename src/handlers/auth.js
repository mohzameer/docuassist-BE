// src/handlers/auth.js
import {
    CognitoIdentityProviderClient,
    AdminCreateUserCommand,
    AdminInitiateAuthCommand,
    AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ulid } from 'ulid';
import dynamoDB from '../lib/dynamodb.js';
import { success, error, notFound } from '../lib/response.js';
import auth from '../middleware/auth.js';
import { getCurrentTimestamp, validateRequiredFields } from '../utils/common.js';

const cognito = new CognitoIdentityProviderClient({});

/**
 * Get current user information
 */
export const getCurrentUser = async (event) => {
    try {
        const user = await auth(event);
        if (user.statusCode) return user;

        console.log('Current user:', user);

        // First query to get the user by user_id_ref
        const queryParams = {
            TableName: process.env.USERS_TABLE,
            IndexName: 'UserIdRefIndex', // We need to create this GSI
            KeyConditionExpression: 'user_id_ref = :user_id_ref',
            ExpressionAttributeValues: {
                ':user_id_ref': user.userId // This is the Cognito ID
            }
        };

        console.log('DynamoDB query params:', queryParams);

        const queryResult = await dynamoDB.query(queryParams);
        console.log('DynamoDB query result:', queryResult);

        if (!queryResult.Items || queryResult.Items.length === 0) {
            console.log('User not found in DynamoDB');
            return notFound('User not found');
        }

        const userRecord = queryResult.Items[0];

        return success({
            ...user,
            ...userRecord
        });
    } catch (err) {
        console.error('Error getting current user:', err);
        return error(err);
    }
};

/**
 * Create new user
 */
export const createUser = async (event) => {
    try {
        const admin = await auth(event);
        if (admin.statusCode) return admin;

        const body = JSON.parse(event.body);
        const { email, givenName, familyName } = body;
        const orgId = admin.orgId;

        const validation = validateRequiredFields(
            { email, givenName, familyName },
            ['email', 'givenName', 'familyName']
        );

        if (!validation.isValid) {
            return error(new Error(validation.message));
        }

        const temporaryPassword = generateTemporaryPassword();
        const userid = ulid();

        // Create user in Cognito
        const createUserCommand = new AdminCreateUserCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: email,
            TemporaryPassword: temporaryPassword,
            UserAttributes: [
                { Name: 'email', Value: email },
                { Name: 'email_verified', Value: 'true' },
                { Name: 'custom:org_id', Value: orgId },
                { Name: 'given_name', Value: givenName },
                { Name: 'family_name', Value: familyName }
            ],
            DesiredDeliveryMediums: ['EMAIL']
        });

        const createUserResponse = await cognito.send(createUserCommand);
        const userIdRef = createUserResponse.User.Username;

        // Store in DynamoDB
        const params = {
            TableName: process.env.USERS_TABLE,
            Item: {
                user_id_ref: userIdRef,
                userId: userid,
                email,
                given_name: givenName,
                family_name: familyName,
                status: 'ACTIVE',
                created_at: getCurrentTimestamp(),
                created_by: admin.userId
            }
        };

        await dynamoDB.put(params);


        return success({
            message: 'User created successfully',
            userId: userId
        });
    } catch (err) {
        console.error('Error creating user:', err);
        return error(err);
    }
};

/**
 * Signup new user
 */
export const signup = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const { email, givenName, familyName, orgId } = body;

        const validation = validateRequiredFields(
            { email, givenName, familyName, orgId },
            ['email', 'givenName', 'familyName', 'orgId']
        );

        if (!validation.isValid) {
            return error(new Error(validation.message));
        }

        const temporaryPassword = generateTemporaryPassword();
        const userId = ulid();

        // Create user in Cognito
        const createUserCommand = new AdminCreateUserCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: email,
            TemporaryPassword: temporaryPassword,
            UserAttributes: [
                { Name: 'email', Value: email },
                { Name: 'email_verified', Value: 'true' },
                { Name: 'custom:org_id', Value: orgId },
                { Name: 'given_name', Value: givenName },
                { Name: 'family_name', Value: familyName }
            ],
            DesiredDeliveryMediums: ['EMAIL']
        });

        const createUserResponse = await cognito.send(createUserCommand);
        const userIdRef = createUserResponse.User.Username;

        // Store in DynamoDB
        const params = {
            TableName: process.env.USERS_TABLE,
            Item: {
                orgId: orgId,
                userId: userId,
                user_id_ref: userIdRef,
                email,
                given_name: givenName,
                family_name: familyName,
                status: 'ACTIVE',
                created_at: getCurrentTimestamp()
            }
        };

        await dynamoDB.put(params);

        return success({
            message: 'User created successfully',
            userId: userId
        });
    } catch (err) {
        console.error('Error creating user:', err);
        return error(err);
    }
};

/**
 * Signup new user with confirmed status
 */
export const signupConfirmed = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const { email, givenName, familyName, orgId, password } = body;

        const validation = validateRequiredFields(
            { email, givenName, familyName, orgId, password },
            ['email', 'givenName', 'familyName', 'orgId', 'password']
        );

        if (!validation.isValid) {
            return error(new Error(validation.message));
        }

        const userId = ulid();

        // Create user in Cognito
        const createUserCommand = new AdminCreateUserCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: email,
            UserAttributes: [
                { Name: 'email', Value: email },
                { Name: 'email_verified', Value: 'true' },
                { Name: 'custom:org_id', Value: orgId },
                { Name: 'given_name', Value: givenName },
                { Name: 'family_name', Value: familyName }
            ],
            MessageAction: 'SUPPRESS'
        });

        const createUserResponse = await cognito.send(createUserCommand);
        const userIdRef = createUserResponse.User.Username;

        // Set user password and mark as confirmed
        await cognito.send(new AdminSetUserPasswordCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: email,
            Password: password,
            Permanent: true
        }));

        // Store in DynamoDB
        const params = {
            TableName: process.env.USERS_TABLE,
            Item: {
                orgId: orgId,
                userId: userId,
                user_id_ref: userIdRef,
                email,
                given_name: givenName,
                family_name: familyName,
                status: 'ACTIVE',
                created_at: getCurrentTimestamp()
            }
        };

        await dynamoDB.put(params);

        return success({
            message: 'User created and confirmed successfully',
            userId: userId
        });
    } catch (err) {
        console.error('Error creating and confirming user:', err);
        return error(err);
    }
};

/**
 * Refresh token
 */
export const refreshToken = async (event) => {
    try {
        const { refreshToken } = JSON.parse(event.body);

        if (!refreshToken) {
            return error(new Error('Refresh token is required'));
        }

        const result = await cognito.send(new AdminInitiateAuthCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            ClientId: process.env.COGNITO_CLIENT_ID,
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            AuthParameters: {
                REFRESH_TOKEN: refreshToken
            }
        }));

        return success({
            accessToken: result.AuthenticationResult.AccessToken,
            idToken: result.AuthenticationResult.IdToken,
            expiresIn: result.AuthenticationResult.ExpiresIn
        });
    } catch (err) {
        console.error('Error refreshing token:', err);
        return error(err);
    }
};

/**
 * Validate token
 */
export const validateToken = async (event) => {
    try {
        const { idToken, accessToken } = JSON.parse(event.body);

        if (!idToken && !accessToken) {
            return error(new Error('At least one token is required'));
        }

        let idTokenValid = true, accessTokenValid = true;

        if (idToken) {
            try {
                await idTokenVerifier.verify(idToken);
            } catch (error) {
                console.error('ID Token verification failed:', error);
                idTokenValid = false;
            }
        }

        if (accessToken) {
            try {
                await accessTokenVerifier.verify(accessToken);
            } catch (error) {
                console.error('Access Token verification failed:', error);
                accessTokenValid = false;
            }
        }

        if (!idTokenValid && !accessTokenValid) {
            return error(new Error('Both tokens are invalid or expired'));
        }

        return success({
            idTokenValid,
            accessTokenValid
        });
    } catch (err) {
        console.error('Error validating token:', err);
        return error(err);
    }
};

/**
 * Login user
 */
export const loginUser = async (event) => {
    const { username, password } = JSON.parse(event.body);

    try {
        const response = await cognito.send(new AdminInitiateAuthCommand({
            AuthFlow: 'ADMIN_NO_SRP_AUTH',
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            ClientId: process.env.COGNITO_CLIENT_ID,
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password,
            },
        }));

        return success({
            message: 'Login successful',
            accessToken: response.AuthenticationResult.AccessToken,
            idToken: response.AuthenticationResult.IdToken,
            refreshToken: response.AuthenticationResult.RefreshToken,
        });
    } catch (err) {
        console.error('Error logging in:', err);
        return error(new Error('Login failed: ' + err.message));
    }
};


/**
 * Generate temporary password
 */
function generateTemporaryPassword() {
    const length = 12;
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*';
    const allChars = uppercase + lowercase + numbers + special;

    // Ensure at least one of each type
    let password =
        uppercase[Math.floor(Math.random() * uppercase.length)] +
        lowercase[Math.floor(Math.random() * lowercase.length)] +
        numbers[Math.floor(Math.random() * numbers.length)] +
        special[Math.floor(Math.random() * special.length)];

    // Fill remaining length with random characters
    for (let i = password.length; i < length; i++) {
        const randomChar = allChars[Math.floor(Math.random() * allChars.length)];
        password += randomChar;
    }

    // Shuffle the password
    return password
        .split('')
        .sort(() => Math.random() - 0.5)
        .join('');
}

