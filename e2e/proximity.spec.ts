/**
 * Proximity Service — E2E Tests
 *
 * Tests against the LIVE production deployment.
 * Verifies real functionality, not just HTTP status codes.
 *
 * Run: PROXIMITY_API_KEY=<key> npx playwright test
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://proximity-service-production-87bc.up.railway.app';
const API_KEY = process.env.PROXIMITY_API_KEY || '';

// Helper for authenticated requests
function authHeaders(extra: Record<string, string> = {}) {
    return {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        ...extra,
    };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. HEALTH CHECK (no auth required)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Health Check', () => {
    test('GET /health returns ok without API key', async ({ request }) => {
        const res = await request.get(`${BASE}/health`);
        expect(res.status()).toBe(200);

        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.service).toBe('proximity-service');
        expect(body.version).toBe('1.0.0');
        expect(body.uptime).toBeGreaterThan(0);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. API KEY AUTH GATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('API Key Auth', () => {
    test('rejects requests without API key', async () => {
        // Use raw fetch to avoid Playwright's extraHTTPHeaders which include the key
        const res = await fetch(`${BASE}/api/proximity/status`);
        expect(res.status).toBe(401);

        const body = await res.json();
        expect(body.error).toContain('Unauthorized');
    });

    test('rejects requests with wrong API key', async ({ request }) => {
        const res = await request.get(`${BASE}/api/proximity/status`, {
            headers: { 'X-API-Key': 'wrong-key-12345' },
        });
        expect(res.status()).toBe(401);
    });

    test('accepts requests with valid API key', async ({ request }) => {
        const res = await request.get(`${BASE}/api/proximity/status`, {
            headers: authHeaders(),
        });
        expect(res.status()).toBe(200);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. STATUS / CAPABILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Service Status', () => {
    test('reports all capabilities', async ({ request }) => {
        const res = await request.get(`${BASE}/api/proximity/status`, {
            headers: authHeaders(),
        });
        const body = await res.json();

        expect(body.capabilities.gps).toBe(true);
        expect(body.capabilities.distanceCalculation).toBe(true);
        expect(body.capabilities.nearbyFiltering).toBe(true);
        expect(body.capabilities.consentManagement).toBe(true);
        expect(body.capabilities.realtimeBroadcasting).toBe(true);
        expect(body.capabilities.ble).toBe(false); // BLE is client-side only

        expect(body.gdpr.consentRequired).toBe(true);
        expect(body.gdpr.consentRevocable).toBe(true);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. DISTANCE CALCULATION — with known reference values
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Distance Calculation', () => {
    test('Berlin → Munich ≈ 504km', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/calculate`, {
            headers: authHeaders(),
            data: {
                from: { lat: 52.52, lng: 13.405 },
                to: { lat: 48.1351, lng: 11.582 },
            },
        });
        expect(res.status()).toBe(200);

        const body = await res.json();
        // Haversine: Berlin → Munich should be ~504km ±5km
        expect(body.distanceMeters).toBeGreaterThan(499_000);
        expect(body.distanceMeters).toBeLessThan(510_000);
        expect(body.distanceLabel).toContain('km');
        expect(body.status).toBe('out_of_range');
    });

    test('same point → 0m', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/calculate`, {
            headers: authHeaders(),
            data: {
                from: { lat: 52.52, lng: 13.405 },
                to: { lat: 52.52, lng: 13.405 },
            },
        });
        const body = await res.json();
        expect(body.distanceMeters).toBe(0);
        expect(body.status).toBe('nearby');
    });

    test('short distance (~300m) classified correctly', async ({ request }) => {
        // Brandenburg Gate → Reichstag ≈ ~300m
        const res = await request.post(`${BASE}/api/proximity/calculate`, {
            headers: authHeaders(),
            data: {
                from: { lat: 52.5163, lng: 13.3777 },
                to: { lat: 52.5186, lng: 13.3761 },
            },
        });
        const body = await res.json();
        expect(body.distanceMeters).toBeLessThan(1000);
        expect(body.distanceMeters).toBeGreaterThan(100);
        expect(['nearby', 'in_range']).toContain(body.status);
    });

    test('medium distance (3km) → in_range status', async ({ request }) => {
        // Alexanderplatz → Potsdamer Platz ≈ 3km
        const res = await request.post(`${BASE}/api/proximity/calculate`, {
            headers: authHeaders(),
            data: {
                from: { lat: 52.5219, lng: 13.4132 },
                to: { lat: 52.5096, lng: 13.3761 },
            },
        });
        const body = await res.json();
        expect(body.distanceMeters).toBeGreaterThan(1500);
        expect(body.distanceMeters).toBeLessThan(5000);
        expect(body.status).toBe('in_range');
    });

    test('rejects missing coordinates', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/calculate`, {
            headers: authHeaders(),
            data: { from: { lat: 52.52 }, to: { lat: 48.13 } },
        });
        expect(res.status()).toBe(400);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. NEARBY FILTERING — verifies actual filtering logic
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Nearby Filtering', () => {
    const myPosition = { lat: 52.52, lng: 13.405 }; // Central Berlin

    const candidates = [
        { profileId: 'close-1', location: { lat: 52.5186, lng: 13.3761 } },     // ~2km away (Reichstag)
        { profileId: 'close-2', location: { lat: 52.5096, lng: 13.3761 } },     // ~3km away (Potsdamer Platz)
        { profileId: 'medium', location: { lat: 52.4631, lng: 13.3209 } },      // ~8km away (Steglitz)
        { profileId: 'far-away', location: { lat: 48.1351, lng: 11.582 } },     // 504km (Munich)
        { profileId: 'very-close', location: { lat: 52.521, lng: 13.407 } },    // ~200m away
    ];

    test('filters to only nearby profiles within 5km', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/nearby`, {
            headers: authHeaders(),
            data: { myPosition, candidates, maxRadiusMeters: 5000 },
        });
        expect(res.status()).toBe(200);

        const body = await res.json();
        expect(body.totalCandidates).toBe(5);
        // Only close-1, close-2, and very-close should be within 5km
        expect(body.count).toBe(3);

        const ids = body.nearby.map((n: any) => n.profileId);
        expect(ids).toContain('close-1');
        expect(ids).toContain('close-2');
        expect(ids).toContain('very-close');
        expect(ids).not.toContain('far-away');
        expect(ids).not.toContain('medium'); // 8km > 5km
    });

    test('results are sorted by distance (closest first)', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/nearby`, {
            headers: authHeaders(),
            data: { myPosition, candidates, maxRadiusMeters: 5000 },
        });
        const body = await res.json();

        // First result should be the closest (~200m)
        expect(body.nearby[0].profileId).toBe('very-close');
        expect(body.nearby[0].distanceMeters).toBeLessThan(500);

        // Each subsequent result should be farther
        for (let i = 1; i < body.nearby.length; i++) {
            expect(body.nearby[i].distanceMeters).toBeGreaterThanOrEqual(
                body.nearby[i - 1].distanceMeters
            );
        }
    });

    test('wider radius includes more profiles', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/nearby`, {
            headers: authHeaders(),
            data: { myPosition, candidates, maxRadiusMeters: 10_000 },
        });
        const body = await res.json();
        // 10km radius should include Steglitz (8km) too
        expect(body.count).toBe(4);
        const ids = body.nearby.map((n: any) => n.profileId);
        expect(ids).toContain('medium');
    });

    test('very tight radius returns only closest', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/nearby`, {
            headers: authHeaders(),
            data: { myPosition, candidates, maxRadiusMeters: 500 },
        });
        const body = await res.json();
        expect(body.count).toBe(1);
        expect(body.nearby[0].profileId).toBe('very-close');
    });

    test('each result has distance label and status', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/nearby`, {
            headers: authHeaders(),
            data: { myPosition, candidates, maxRadiusMeters: 5000 },
        });
        const body = await res.json();

        for (const entry of body.nearby) {
            expect(entry.distanceMeters).toBeDefined();
            expect(entry.distanceLabel).toBeDefined();
            expect(entry.status).toBeDefined();
            expect(['nearby', 'in_range', 'out_of_range']).toContain(entry.status);
        }
    });

    test('empty candidates returns empty result', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/nearby`, {
            headers: authHeaders(),
            data: { myPosition, candidates: [], maxRadiusMeters: 5000 },
        });
        const body = await res.json();
        expect(body.count).toBe(0);
        expect(body.nearby).toHaveLength(0);
    });

    test('rejects invalid input', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/nearby`, {
            headers: authHeaders(),
            data: { myPosition: { lat: 52.52 }, candidates: [] },
        });
        expect(res.status()).toBe(400);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. CONSENT LIFECYCLE — create → validate → revoke → validate again
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Consent Lifecycle', () => {
    test('full lifecycle: create → validate → revoke → verify revoked', async ({ request }) => {
        // Step 1: Create consent
        const createRes = await request.post(`${BASE}/api/proximity/consent`, {
            headers: authHeaders(),
            data: {
                action: 'create',
                profileId: 'test-user-e2e',
                locationTracking: true,
                bleDiscovery: false,
            },
        });
        expect(createRes.status()).toBe(200);
        const created = await createRes.json();

        expect(created.consent.profileId).toBe('test-user-e2e');
        expect(created.consent.locationTracking).toBe(true);
        expect(created.consent.bleDiscovery).toBe(false);
        expect(created.consent.grantedAt).toBeDefined();
        expect(created.valid).toBe(true);

        // Step 2: Validate the consent
        const validateRes = await request.post(`${BASE}/api/proximity/consent`, {
            headers: authHeaders(),
            data: {
                action: 'validate',
                profileId: 'test-user-e2e',
                consent: created.consent,
            },
        });
        expect(validateRes.status()).toBe(200);
        const validated = await validateRes.json();
        expect(validated.valid).toBe(true);

        // Step 3: Revoke the consent
        const revokeRes = await request.post(`${BASE}/api/proximity/consent`, {
            headers: authHeaders(),
            data: {
                action: 'revoke',
                profileId: 'test-user-e2e',
                consent: created.consent,
            },
        });
        expect(revokeRes.status()).toBe(200);
        const revoked = await revokeRes.json();
        expect(revoked.valid).toBe(false);
        expect(revoked.consent.revokedAt).toBeDefined();

        // Step 4: Validate the revoked consent — should be invalid
        const revalidateRes = await request.post(`${BASE}/api/proximity/consent`, {
            headers: authHeaders(),
            data: {
                action: 'validate',
                profileId: 'test-user-e2e',
                consent: revoked.consent,
            },
        });
        expect(revalidateRes.status()).toBe(200);
        const revalidated = await revalidateRes.json();
        expect(revalidated.valid).toBe(false);
    });

    test('consent without locationTracking defaults to false', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/consent`, {
            headers: authHeaders(),
            data: {
                action: 'create',
                profileId: 'default-test',
            },
        });
        const body = await res.json();
        expect(body.consent.locationTracking).toBe(false);
        expect(body.consent.bleDiscovery).toBe(false);
    });

    test('rejects create without profileId', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/consent`, {
            headers: authHeaders(),
            data: { action: 'create' },
        });
        expect(res.status()).toBe(400);
    });

    test('rejects validate without consent object', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/consent`, {
            headers: authHeaders(),
            data: { action: 'validate', profileId: 'test' },
        });
        expect(res.status()).toBe(400);
    });

    test('rejects unknown action', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/consent`, {
            headers: authHeaders(),
            data: { action: 'delete', profileId: 'test' },
        });
        expect(res.status()).toBe(400);
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. SSE BROADCASTING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('SSE Broadcasting', () => {
    test('broadcast publishes to a channel', async ({ request }) => {
        const channelId = `e2e-test-${Date.now()}`;
        const res = await request.post(`${BASE}/api/proximity/broadcast`, {
            headers: authHeaders(),
            data: {
                channelId,
                profileId: 'broadcaster-1',
                location: { lat: 52.52, lng: 13.405 },
                metadata: { role: 'provider', category: 'test' },
            },
        });
        expect(res.status()).toBe(200);

        const body = await res.json();
        expect(body.published).toBe(true);
        expect(body.channelId).toBe(channelId);
        expect(typeof body.subscriberCount).toBe('number');
    });

    test('channels endpoint lists active channels', async ({ request }) => {
        const res = await request.get(`${BASE}/api/proximity/channels`, {
            headers: authHeaders(),
        });
        expect(res.status()).toBe(200);

        const body = await res.json();
        expect(Array.isArray(body.channels)).toBe(true);
        expect(typeof body.total).toBe('number');
    });

    test('broadcast rejects missing channelId', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/broadcast`, {
            headers: authHeaders(),
            data: {
                profileId: 'test',
                location: { lat: 52.52, lng: 13.405 },
            },
        });
        expect(res.status()).toBe(400);
    });

    test('broadcast rejects missing location', async ({ request }) => {
        const res = await request.post(`${BASE}/api/proximity/broadcast`, {
            headers: authHeaders(),
            data: {
                channelId: 'test-channel',
                profileId: 'test',
            },
        });
        expect(res.status()).toBe(400);
    });

    test('SSE stream returns event-stream content type', async ({ request }) => {
        const channelId = `e2e-stream-${Date.now()}`;

        // Use a raw fetch with AbortController for SSE
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        try {
            const res = await fetch(`${BASE}/api/proximity/stream/${channelId}`, {
                headers: { 'X-API-Key': API_KEY },
                signal: controller.signal,
            });

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('text/event-stream');

            // Read the first chunk — should be the "connected" event
            const reader = res.body!.getReader();
            const { value } = await reader.read();
            const text = new TextDecoder().decode(value);

            expect(text).toContain('event: connected');
            expect(text).toContain(channelId);

            reader.cancel();
        } catch (e: any) {
            if (e.name !== 'AbortError') throw e;
        } finally {
            clearTimeout(timeout);
        }
    });

    test('SSE receives broadcast events in real-time', async ({ request }) => {
        const channelId = `e2e-realtime-${Date.now()}`;

        // 1. Subscribe to the channel
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
            const streamRes = await fetch(`${BASE}/api/proximity/stream/${channelId}`, {
                headers: { 'X-API-Key': API_KEY },
                signal: controller.signal,
            });

            const reader = streamRes.body!.getReader();

            // Read the connection event
            const { value: connectChunk } = await reader.read();
            const connectText = new TextDecoder().decode(connectChunk);
            expect(connectText).toContain('event: connected');

            // 2. Broadcast a position update
            const broadcastRes = await request.post(`${BASE}/api/proximity/broadcast`, {
                headers: authHeaders(),
                data: {
                    channelId,
                    profileId: 'realtime-sender',
                    location: { lat: 52.52, lng: 13.405 },
                },
            });
            const broadcastBody = await broadcastRes.json();
            expect(broadcastBody.subscriberCount).toBe(1);

            // 3. Read the broadcast event from the stream
            const { value: eventChunk } = await reader.read();
            const eventText = new TextDecoder().decode(eventChunk);
            expect(eventText).toContain('event: position');
            expect(eventText).toContain('realtime-sender');
            expect(eventText).toContain('52.52');

            reader.cancel();
        } catch (e: any) {
            if (e.name !== 'AbortError') throw e;
        } finally {
            clearTimeout(timeout);
        }
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. OPENAPI SPEC — structure validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('OpenAPI Spec', () => {
    test('returns valid OpenAPI 3.0 spec with all endpoints', async ({ request }) => {
        const res = await request.get(`${BASE}/api/openapi.json`, {
            headers: authHeaders(),
        });
        expect(res.status()).toBe(200);

        const spec = await res.json();
        expect(spec.openapi).toMatch(/^3\.0/);
        expect(spec.info.title).toBe('Proximity Service');
        expect(spec.info.version).toBe('1.0.0');

        // Verify all documented paths exist
        const paths = Object.keys(spec.paths);
        expect(paths).toContain('/health');
        expect(paths).toContain('/api/proximity/calculate');
        expect(paths).toContain('/api/proximity/nearby');
        expect(paths).toContain('/api/proximity/consent');

        // Verify schemas are defined
        expect(spec.components?.schemas?.GeoPoint).toBeDefined();
    });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9. DOMAIN AGNOSTICISM — no domain-specific language in API responses
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Domain Agnosticism', () => {
    test('responses contain no domain-specific terminology', async ({ request }) => {
        const endpoints = [
            { method: 'GET', path: '/api/proximity/status' },
            { method: 'GET', path: '/api/openapi.json' },
        ];

        const domainTerms = ['healer', 'seeker', 'holdspace', 'patient', 'doctor', 'soulsync', 'twintap'];

        for (const ep of endpoints) {
            const res = await request.get(`${BASE}${ep.path}`, {
                headers: authHeaders(),
            });
            const text = await res.text();
            const lowerText = text.toLowerCase();

            for (const term of domainTerms) {
                expect(lowerText).not.toContain(term);
            }
        }
    });
});
