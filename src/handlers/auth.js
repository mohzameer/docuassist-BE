// src/handlers/auth.js
import {
    CognitoIdentityProviderClient,
    AdminCreateUserCommand,
    AdminGetUserCommand,
    AdminDeleteUserCommand,
    AdminUpdateUserAttributesCommand,
    AdminInitiateAuthCommand,
    AdminRespondToAuthChallengeCommand,
    AdminSetUserPasswordCommand,
    ForgotPasswordCommand,
    ConfirmForgotPasswordCommand,
    GlobalSignOutCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuidv4 } from 'uuid';
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

        // Get additional user info from DynamoDB
        const params = {
            TableName: process.env.USERS_TABLE,
            Key: {
                tenant_id: user.tenantId,
                user_id: user.userId
            }
        };

        console.log('DynamoDB query params:', params);

        const result = await dynamoDB.get(params);

        console.log('DynamoDB result:', result);

        if (!result.Item) {
            console.log('User not found in DynamoDB');
            return notFound('User not found');
        }

        return success({
            ...user,
            ...result.Item
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
        const tenantId = admin.tenantId;

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
                { Name: 'custom:tenant_id', Value: tenantId },
                { Name: 'given_name', Value: givenName },
                { Name: 'family_name', Value: familyName }
            ],
            DesiredDeliveryMediums: ['EMAIL']
        });

        const createUserResponse = await cognito.send(createUserCommand);
        const userId = createUserResponse.User.Username;

        // Store in DynamoDB
        const params = {
            TableName: process.env.USERS_TABLE,
            Item: {
                tenant_id: tenantId,
                user_id: userId,
                userid: userid,
                email,
                given_name: givenName,
                family_name: familyName,
                status: 'ACTIVE',
                created_at: getCurrentTimestamp(),
                created_by: admin.userId
            }
        };

        await dynamoDB.put(params);

        // Log activity
        await logActivity(tenantId, admin.userId, 'CREATE_USER', {
            created_user_id: userId,
            email
        });

        return success({
            message: 'User created successfully',
            user_id: userId
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
        const { email, givenName, familyName, tenantId } = body;

        const validation = validateRequiredFields(
            { email, givenName, familyName, tenantId },
            ['email', 'givenName', 'familyName', 'tenantId']
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
                { Name: 'custom:tenant_id', Value: tenantId },
                { Name: 'given_name', Value: givenName },
                { Name: 'family_name', Value: familyName }
            ],
            DesiredDeliveryMediums: ['EMAIL']
        });

        await cognito.send(createUserCommand);

        // Store in DynamoDB
        const params = {
            TableName: process.env.USERS_TABLE,
            Item: {
                tenant_id: tenantId,
                user_id: userId,
                userid: userId,
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
            user_id: userId
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
        const { email, givenName, familyName, tenantId, password } = body;

        const validation = validateRequiredFields(
            { email, givenName, familyName, tenantId, password },
            ['email', 'givenName', 'familyName', 'tenantId', 'password']
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
                { Name: 'custom:tenant_id', Value: tenantId },
                { Name: 'given_name', Value: givenName },
                { Name: 'family_name', Value: familyName }
            ],
            MessageAction: 'SUPPRESS'
        });

        await cognito.send(createUserCommand);

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
                tenant_id: tenantId,
                user_id: userId,
                userid: userId,
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
            user_id: userId
        });
    } catch (err) {
        console.error('Error creating and confirming user:', err);
        return error(err);
    }
};

/**
 * Update user information
 */
export const updateUser = async (event) => {
    try {
        const admin = await auth(event);
        if (admin.statusCode) return admin;

        const { userId } = event.pathParameters;
        const body = JSON.parse(event.body);
        const { givenName, familyName } = body;
        const tenantId = admin.tenantId;

        // Get existing user
        const existingUser = await getUser(tenantId, userId);
        if (!existingUser) {
            return notFound('User not found');
        }

        // Update Cognito attributes
        const updateAttributes = [];
        if (givenName) updateAttributes.push({ Name: 'given_name', Value: givenName });
        if (familyName) updateAttributes.push({ Name: 'family_name', Value: familyName });

        if (updateAttributes.length > 0) {
            await cognito.send(new AdminUpdateUserAttributesCommand({
                UserPoolId: process.env.COGNITO_USER_POOL_ID,
                Username: existingUser.email,
                UserAttributes: updateAttributes
            }));
        }

        // Update DynamoDB
        const updateParams = {
            TableName: process.env.USERS_TABLE,
            Key: {
                tenant_id: tenantId,
                user_id: userId
            },
            UpdateExpression: 'set updated_at = :ua, updated_by = :ub',
            ExpressionAttributeValues: {
                ':ua': getCurrentTimestamp(),
                ':ub': admin.userId
            }
        };

        if (givenName || familyName) {
            updateParams.UpdateExpression += givenName ? ', given_name = :gn' : '';
            updateParams.UpdateExpression += familyName ? ', family_name = :fn' : '';
            if (givenName) updateParams.ExpressionAttributeValues[':gn'] = givenName;
            if (familyName) updateParams.ExpressionAttributeValues[':fn'] = familyName;
        }

        await dynamoDB.update(updateParams);

        // // Log activity
        // await logActivity(tenantId, admin.userId, 'UPDATE_USER', {
        //     updated_user_id: userId,
        //     changes: { givenName, familyName }
        // });

        return success({
            message: 'User updated successfully'
        });
    } catch (err) {
        console.error('Error updating user:', err);
        return error(err);
    }
};

/**
 * Delete user
 */
export const deleteUser = async (event) => {
    try {
        const admin = await auth(event);
        if (admin.statusCode) return admin;

        const { userId } = event.pathParameters;
        const tenantId = admin.tenantId;

        // Get existing user
        const existingUser = await getUser(tenantId, userId);
        if (!existingUser) {
            return notFound('User not found');
        }

        // Delete from Cognito
        await cognito.send(new AdminDeleteUserCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: existingUser.email
        }));

        // Delete from DynamoDB
        await dynamoDB.delete({
            TableName: process.env.USERS_TABLE,
            Key: {
                tenant_id: tenantId,
                user_id: userId
            }
        });

        // Log activity
        await logActivity(tenantId, admin.userId, 'DELETE_USER', {
            deleted_user_id: userId,
            email: existingUser.email
        });

        return success({
            message: 'User deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting user:', err);
        return error(err);
    }
};

/**
 * Get user by ID
 */
export const getUserById = async (event) => {
    try {
        const user = await auth(event);
        if (user.statusCode) return user;

        const { userId } = event.pathParameters;
        const tenantId = user.tenantId;

        const existingUser = await getUser(tenantId, userId);
        if (!existingUser) {
            return notFound('User not found');
        }

        return success(existingUser);
    } catch (err) {
        console.error('Error getting user:', err);
        return error(err);
    }
};

/**
 * List users with pagination and filters
 */
export const listUsers = async (event) => {
    try {
        const user = await auth(event);
        if (user.statusCode) return user;

        const { nextToken, limit = '50', status } = event.queryStringParameters || {};
        const tenantId = user.tenantId;

        let params = {
            TableName: process.env.USERS_TABLE,
            KeyConditionExpression: 'tenant_id = :tid',
            ExpressionAttributeValues: {
                ':tid': tenantId
            }
        };

        if (status) {
            params.FilterExpression = 'status = :status';
            params.ExpressionAttributeValues[':status'] = status;
        }

        if (nextToken) {
            params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
        }

        params.Limit = parseInt(limit);

        const result = await dynamoDB.query(params);
        const response = {
            users: result.Items
        };

        if (result.LastEvaluatedKey) {
            response.nextToken = Buffer.from(
                JSON.stringify(result.LastEvaluatedKey)
            ).toString('base64');
        }

        return success(response);
    } catch (err) {
        console.error('Error listing users:', err);
        return error(err);
    }
};

/**
 * Change password
 */
export const changePassword = async (event) => {
    try {
        const user = await auth(event);
        if (user.statusCode) return user;

        const { oldPassword, newPassword } = JSON.parse(event.body);

        if (!oldPassword || !newPassword) {
            return error(new Error('Old and new passwords are required'));
        }

        await cognito.send(new AdminInitiateAuthCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            ClientId: process.env.COGNITO_CLIENT_ID,
            AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
            AuthParameters: {
                USERNAME: user.email,
                PASSWORD: oldPassword
            }
        }));

        await cognito.send(new AdminSetUserPasswordCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: user.email,
            Password: newPassword,
            Permanent: true
        }));

        // Log activity
        await logActivity(user.tenantId, user.userId, 'CHANGE_PASSWORD', {});

        return success({
            message: 'Password changed successfully'
        });
    } catch (err) {
        console.error('Error changing password:', err);
        return error(err);
    }
};

/**
 * Initiate password reset
 */
export const initiateResetPassword = async (event) => {
    try {
        const { email } = JSON.parse(event.body);

        if (!email) {
            return error(new Error('Email is required'));
        }

        await cognito.send(new ForgotPasswordCommand({
            ClientId: process.env.COGNITO_CLIENT_ID,
            Username: email
        }));

        return success({
            message: 'Password reset initiated successfully'
        });
    } catch (err) {
        console.error('Error initiating password reset:', err);
        return error(err);
    }
};

/**
 * Complete password reset
 */
export const completeResetPassword = async (event) => {
    try {
        const { email, code, newPassword } = JSON.parse(event.body);

        if (!email || !code || !newPassword) {
            return error(new Error('Email, code, and new password are required'));
        }

        await cognito.send(new ConfirmForgotPasswordCommand({
            ClientId: process.env.COGNITO_CLIENT_ID,
            Username: email,
            ConfirmationCode: code,
            Password: newPassword
        }));

        return success({
            message: 'Password reset completed successfully'
        });
    } catch (err) {
        console.error('Error completing password reset:', err);
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
 * Sign out user
 */
export const signout = async (event) => {
    try {
        // const user = await auth(event);
        // if (user.statusCode) return user;

        await cognito.send(new GlobalSignOutCommand({
            AccessToken: event.headers.Authorization.replace('Bearer ', '')
        }));

        return success({ message: 'Signout successful' });
    } catch (err) {
        console.error('Error signing out:', err);
        return error(new Error('Signout failed: ' + err.message));
    }
};

// Helper Functions

/**
 * Get user from DynamoDB
 */
async function getUser(tenantId, userId) {
    const params = {
        TableName: process.env.USERS_TABLE,
        Key: {
            tenant_id: tenantId,
            user_id: userId
        }
    };

    const result = await dynamoDB.get(params);
    return result.Item;
}

/**
 * Log activity
 */
async function logActivity(tenantId, userId, action, details) {
    const activityParams = {
        TableName: process.env.ACTIVITY_LOG_TABLE,
        Item: {
            tenant_id: tenantId,
            activity_id: uuidv4(),
            user_id: userId,
            action,
            timestamp: getCurrentTimestamp(),
            details
        }
    };

    await dynamoDB.put(activityParams);
}

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

/**
 * Check if user exists in Cognito
 */
async function checkUserExists(email) {
    try {
        await cognito.send(new AdminGetUserCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: email
        }));
        return true;
    } catch (err) {
        if (err.name === 'UserNotFoundException') {
            return false;
        }
        throw err;
    }
}

/**
 * Format Cognito user attributes
 */
function formatUserAttributes(attributes) {
    return attributes.reduce((acc, attr) => {
        acc[attr.Name.replace('custom:', '')] = attr.Value;
        return acc;
    }, {});
}

/**
 * Validate password strength
 */
function validatePassword(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*]/.test(password);

    const validations = {
        length: password.length >= minLength,
        upperCase: hasUpperCase,
        lowerCase: hasLowerCase,
        numbers: hasNumbers,
        specialChar: hasSpecialChar
    };

    const isValid = Object.values(validations).every(Boolean);

    return {
        isValid,
        validations,
        message: isValid ? 'Password is valid' : 'Password does not meet requirements'
    };
}

/**
 * Handle authentication challenge
 */
async function handleAuthChallenge(username, session, challengeResponses) {
    try {
        const result = await cognito.send(new AdminRespondToAuthChallengeCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            ClientId: process.env.COGNITO_CLIENT_ID,
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            ChallengeResponses: challengeResponses,
            Session: session
        }));

        return result;
    } catch (err) {
        console.error('Error handling auth challenge:', err);
        throw err;
    }
}