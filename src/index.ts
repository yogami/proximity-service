/**
 * Proximity Service — Hono HTTP API
 *
 * Standalone, domain-agnostic microservice for consent-based proximity detection.
 * Part of the Berlin AI Automation Studio ecosystem.
 *
 * Endpoints:
 *   GET  /health                         → Health check
 *   GET  /api/openapi.json               → OpenAPI manifest
 *   GET  /api/proximity/status           → Service capabilities
 *   POST /api/proximity/calculate        → Distance between two points
 *   POST /api/proximity/nearby           → Find nearby profiles
 *   POST /api/proximity/consent          → Consent management
 *   POST /api/proximity/broadcast        → Publish position to SSE channel
 *   GET  /api/proximity/stream/:channel  → Subscribe to SSE position events
 *   GET  /api/proximity/channels         → List active channels
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import {
    calculateDistance,
    classifyDistance,
    formatDistance,
    findNearby,
    createConsent,
    isConsentValid,
    revokeConsent,
    type GeoPoint,
    type LocationConsent,
} from './domain.js';
import { OPENAPI_SPEC } from './openapi.js';

const app = new Hono();
const startTime = Date.now();

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use('*', cors());
app.use('*', logger());

// ─── Health ─────────────────────────────────────────────────────────────────

app.get('/health', (c) => {
    return c.json({
        status: 'ok',
        service: 'proximity-service',
        version: '1.0.0',
        uptime: Math.floor((Date.now() - startTime) / 1000),
    });
});

// ─── OpenAPI ────────────────────────────────────────────────────────────────

app.get('/api/openapi.json', (c) => {
    return c.json(OPENAPI_SPEC);
});

// ─── Status ─────────────────────────────────────────────────────────────────

app.get('/api/proximity/status', (c) => {
    return c.json({
        service: 'proximity-service',
        capabilities: {
            gps: true,
            ble: false, // Server-side — BLE is client-only
            distanceCalculation: true,
            nearbyFiltering: true,
            consentManagement: true,
            realtimeBroadcasting: true,
        },
        defaults: {
            maxRangeMeters: 5000,
            bleRangeMeters: 30,
        },
        gdpr: {
            consentRequired: true,
            consentRevocable: true,
            dataMinimization: 'Coordinates are never stored. All calculations are stateless.',
        },
    });
});

// ─── Calculate Distance ─────────────────────────────────────────────────────

app.post('/api/proximity/calculate', async (c) => {
    const body = await c.req.json<{ from: GeoPoint; to: GeoPoint }>();

    if (!body.from?.lat || !body.from?.lng || !body.to?.lat || !body.to?.lng) {
        return c.json({ error: 'Both "from" and "to" must have lat and lng' }, 400);
    }

    const distance = calculateDistance(body.from, body.to);

    return c.json({
        from: body.from,
        to: body.to,
        distanceMeters: Math.round(distance),
        distanceLabel: formatDistance(distance),
        status: classifyDistance(distance),
    });
});

// ─── Find Nearby ────────────────────────────────────────────────────────────

app.post('/api/proximity/nearby', async (c) => {
    const body = await c.req.json<{
        myPosition: GeoPoint;
        candidates: Array<{ profileId: string; location: GeoPoint }>;
        maxRadiusMeters?: number;
    }>();

    if (!body.myPosition?.lat || !body.myPosition?.lng) {
        return c.json({ error: '"myPosition" must have lat and lng' }, 400);
    }

    if (!Array.isArray(body.candidates)) {
        return c.json({ error: '"candidates" must be an array' }, 400);
    }

    const nearby = findNearby(
        body.myPosition,
        body.candidates,
        body.maxRadiusMeters ?? 5000,
    );

    return c.json({
        nearby,
        count: nearby.length,
        totalCandidates: body.candidates.length,
        maxRadiusMeters: body.maxRadiusMeters ?? 5000,
    });
});

// ─── Consent Management ────────────────────────────────────────────────────

app.post('/api/proximity/consent', async (c) => {
    const body = await c.req.json<{
        action: 'create' | 'validate' | 'revoke';
        profileId: string;
        locationTracking?: boolean;
        bleDiscovery?: boolean;
        consent?: LocationConsent;
    }>();

    switch (body.action) {
        case 'create': {
            if (!body.profileId) {
                return c.json({ error: '"profileId" is required' }, 400);
            }
            const consent = createConsent(body.profileId, {
                locationTracking: body.locationTracking,
                bleDiscovery: body.bleDiscovery,
            });
            return c.json({ consent, valid: isConsentValid(consent) });
        }

        case 'validate': {
            if (!body.consent) {
                return c.json({ error: '"consent" object is required for validation' }, 400);
            }
            return c.json({ valid: isConsentValid(body.consent), consent: body.consent });
        }

        case 'revoke': {
            if (!body.consent) {
                return c.json({ error: '"consent" object is required for revocation' }, 400);
            }
            const revoked = revokeConsent(body.consent);
            return c.json({ consent: revoked, valid: false });
        }

        default:
            return c.json({ error: 'action must be "create", "validate", or "revoke"' }, 400);
    }
});

// ─── Real-Time Broadcasting (SSE) ──────────────────────────────────────────
//
// Domain-agnostic pub/sub channels. Any consumer can:
//   POST /api/proximity/broadcast   → Publish a position update to a channel
//   GET  /api/proximity/stream/:id  → Subscribe to SSE events on a channel
//
// Channels are ephemeral and auto-clean when the last subscriber disconnects.

interface BroadcastEvent {
    profileId: string;
    location: GeoPoint;
    timestamp: string;
    metadata?: Record<string, unknown>;
}

type SSEController = ReadableStreamDefaultController<Uint8Array>;

const channels = new Map<string, Set<SSEController>>();

function getOrCreateChannel(channelId: string): Set<SSEController> {
    let subs = channels.get(channelId);
    if (!subs) {
        subs = new Set();
        channels.set(channelId, subs);
    }
    return subs;
}

app.post('/api/proximity/broadcast', async (c) => {
    const body = await c.req.json<{
        channelId: string;
        profileId: string;
        location: GeoPoint;
        metadata?: Record<string, unknown>;
    }>();

    if (!body.channelId || !body.profileId) {
        return c.json({ error: '"channelId" and "profileId" are required' }, 400);
    }

    if (!body.location?.lat || !body.location?.lng) {
        return c.json({ error: '"location" must have lat and lng' }, 400);
    }

    const event: BroadcastEvent = {
        profileId: body.profileId,
        location: body.location,
        timestamp: new Date().toISOString(),
        metadata: body.metadata,
    };

    const subs = channels.get(body.channelId);
    const subscriberCount = subs?.size ?? 0;

    if (subs && subs.size > 0) {
        const encoded = new TextEncoder().encode(
            `event: position\ndata: ${JSON.stringify(event)}\n\n`
        );
        for (const controller of subs) {
            try {
                controller.enqueue(encoded);
            } catch {
                subs.delete(controller);
            }
        }
    }

    return c.json({
        published: true,
        channelId: body.channelId,
        subscriberCount,
    });
});

app.get('/api/proximity/stream/:channelId', (c) => {
    const channelId = c.req.param('channelId');
    const subs = getOrCreateChannel(channelId);

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            subs.add(controller);

            // Send initial connection event
            const welcomeMsg = new TextEncoder().encode(
                `event: connected\ndata: ${JSON.stringify({
                    channelId,
                    subscriberCount: subs.size,
                    timestamp: new Date().toISOString(),
                })}\n\n`
            );
            controller.enqueue(welcomeMsg);
        },
        cancel(controller) {
            subs.delete(controller as SSEController);
            if (subs.size === 0) {
                channels.delete(channelId);
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        },
    });
});

app.get('/api/proximity/channels', (c) => {
    const channelList = Array.from(channels.entries()).map(([id, subs]) => ({
        channelId: id,
        subscriberCount: subs.size,
    }));
    return c.json({ channels: channelList, total: channelList.length });
});


// ─── Start Server ───────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || '3000', 10);

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`🌍 Proximity Service running on port ${info.port}`);
    console.log(`   Health:  http://localhost:${info.port}/health`);
    console.log(`   OpenAPI: http://localhost:${info.port}/api/openapi.json`);
});
