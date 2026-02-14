/**
 * Proximity Service — OpenAPI Specification
 *
 * Berlin AI Rules require every service to expose /api/openapi.json.
 */

export const OPENAPI_SPEC = {
    openapi: '3.0.3',
    info: {
        title: 'Proximity Service',
        version: '1.0.0',
        description:
            'Consent-based GPS + BLE proximity detection microservice. ' +
            'Provides distance calculation, nearby filtering, and GDPR-compliant consent management. ' +
            'Part of the Berlin AI Automation Studio ecosystem.',
        contact: {
            name: 'Berlin AI Labs',
            url: 'https://berlinailabs.de',
        },
    },
    servers: [
        {
            url: 'https://proximity-service-production.up.railway.app',
            description: 'Production (Railway)',
        },
        {
            url: 'http://localhost:3000',
            description: 'Local development',
        },
    ],
    paths: {
        '/health': {
            get: {
                summary: 'Health check',
                operationId: 'healthCheck',
                responses: {
                    '200': {
                        description: 'Service is healthy',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'ok' },
                                        service: { type: 'string', example: 'proximity-service' },
                                        version: { type: 'string', example: '1.0.0' },
                                        uptime: { type: 'number' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/api/proximity/calculate': {
            post: {
                summary: 'Calculate distance between two GeoPoints',
                operationId: 'calculateDistance',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['from', 'to'],
                                properties: {
                                    from: { $ref: '#/components/schemas/GeoPoint' },
                                    to: { $ref: '#/components/schemas/GeoPoint' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Distance calculated',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        distanceMeters: { type: 'number' },
                                        distanceLabel: { type: 'string' },
                                        status: { type: 'string', enum: ['nearby', 'in_range', 'out_of_range'] },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/api/proximity/nearby': {
            post: {
                summary: 'Find nearby profiles from a candidate list',
                operationId: 'findNearby',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['myPosition', 'candidates'],
                                properties: {
                                    myPosition: { $ref: '#/components/schemas/GeoPoint' },
                                    candidates: {
                                        type: 'array',
                                        items: { $ref: '#/components/schemas/ProfileLocation' },
                                    },
                                    maxRadiusMeters: { type: 'number', default: 5000 },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Nearby profiles sorted by distance',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        nearby: {
                                            type: 'array',
                                            items: { $ref: '#/components/schemas/PresenceRecord' },
                                        },
                                        count: { type: 'number' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/api/proximity/consent': {
            post: {
                summary: 'Create, validate, or revoke a LocationConsent',
                operationId: 'manageConsent',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['action', 'profileId'],
                                properties: {
                                    action: { type: 'string', enum: ['create', 'validate', 'revoke'] },
                                    profileId: { type: 'string' },
                                    locationTracking: { type: 'boolean' },
                                    bleDiscovery: { type: 'boolean' },
                                    consent: { $ref: '#/components/schemas/LocationConsent' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Consent operation result',
                    },
                },
            },
        },
    },
    components: {
        schemas: {
            GeoPoint: {
                type: 'object',
                required: ['lat', 'lng'],
                properties: {
                    lat: { type: 'number', example: 52.52 },
                    lng: { type: 'number', example: 13.405 },
                },
            },
            ProfileLocation: {
                type: 'object',
                required: ['profileId', 'location'],
                properties: {
                    profileId: { type: 'string' },
                    location: { $ref: '#/components/schemas/GeoPoint' },
                },
            },
            PresenceRecord: {
                type: 'object',
                properties: {
                    profileId: { type: 'string' },
                    location: { $ref: '#/components/schemas/GeoPoint' },
                    distanceMeters: { type: 'number' },
                    distanceLabel: { type: 'string' },
                    status: { type: 'string', enum: ['nearby', 'in_range', 'out_of_range'] },
                },
            },
            LocationConsent: {
                type: 'object',
                properties: {
                    profileId: { type: 'string' },
                    locationTracking: { type: 'boolean' },
                    bleDiscovery: { type: 'boolean' },
                    grantedAt: { type: 'string', format: 'date-time' },
                    revokedAt: { type: 'string', format: 'date-time' },
                },
            },
        },
    },
};
