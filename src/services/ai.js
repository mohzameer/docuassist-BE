import axios from 'axios';
import dynamoDB from '../lib/dynamodb.js';

const ragieClient = axios.create({
    baseURL: 'https://api.ragie.ai',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RAGIE_API_KEY}`
    }
});

/**
 * Makes a retrieval request to Ragie API
 * @param {string} query - The user's message
 * @param {string} partitionId - Organization's partition ID
 * @returns {Promise<Object>} - The retrieval response
 */
export const makeRetrieval = async (query, partitionId) => {
    try {
        const response = await ragieClient.post('/retrievals', JSON.stringify({
            query,
            partition: partitionId,
            rerank: true
        }));

        console.log('Ragie Response:', JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        console.error('Ragie API error:', error.response?.data || error.message);
        throw new Error('Failed to get AI response');
    }
};

/**
 * Gets organization's partition ID and makes retrieval request
 * @param {string} query - The user's message
 * @param {string} orgId - The organization ID
 * @returns {Promise<Object>} - The retrieval response
 */
export const getAIResponse = async (query, orgId) => {
    try {
        // Get org's partition_id from DynamoDB
        const orgParams = {
            TableName: process.env.ORG_TABLE,
            Key: {
                orgId: orgId
            }
        };

        const orgResult = await dynamoDB.get(orgParams);
        if (!orgResult.Item || !orgResult.Item.partition_id) {
            throw new Error('Organization partition not found');
        }

        const partitionId = orgResult.Item.partition_id;
        console.log('Partition ID:', partitionId);
        return await makeRetrieval(query, partitionId);
    } catch (error) {
        console.error('AI service error:', error);
        throw error;
    }
}; 