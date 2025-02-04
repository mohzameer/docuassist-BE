import { v4 as uuidv4 } from 'uuid';
import dynamoDB from '../lib/dynamodb.js';
import { success, error } from '../lib/response.js';
import { getCurrentTimestamp, validateRequiredFields } from '../utils/common.js';

/**
 * Create new org
 */
export const createOrg = async (event) => {
    try {
        const body = JSON.parse(event.body);
        const { name, description } = body;

        const validation = validateRequiredFields(
            { name },
            ['name']
        );

        if (!validation.isValid) {
            return error(new Error(validation.message));
        }

        const OrgId = uuidv4();

        // Store in DynamoDB
        const params = {
            TableName: process.env.ORGS_TABLE,
            Item: {
                org_id: OrgId,
                name,
                description,
                created_at: getCurrentTimestamp()
            }
        };

        await dynamoDB.put(params);

        return success({
            message: 'Org created successfully',
            org_id: OrgId
        });
    } catch (err) {
        console.error('Error creating org:', err);
        return error(err);
    }
};
