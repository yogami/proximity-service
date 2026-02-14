/**
 * Proximity Service — Domain Logic
 *
 * Pure functions for distance calculation, consent management,
 * and nearby filtering. No external dependencies.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GeoPoint {
    lat: number;
    lng: number;
}

export type DetectionMethod = 'gps' | 'ble' | 'manual';
export type PresenceStatus = 'nearby' | 'in_range' | 'out_of_range' | 'unknown';

export interface LocationConsent {
    profileId: string;
    locationTracking: boolean;
    bleDiscovery: boolean;
    grantedAt: string;
    revokedAt?: string;
}

export interface PresenceRecord {
    profileId: string;
    location: GeoPoint;
    distanceMeters: number;
    distanceLabel: string;
    status: PresenceStatus;
}

// ─── Distance ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

/**
 * Haversine great-circle distance between two GeoPoints.
 * @returns Distance in meters
 */
export function calculateDistance(from: GeoPoint, to: GeoPoint): number {
    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(from.lat)) *
        Math.cos(toRadians(to.lat)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}

/**
 * Classify distance into a presence status.
 */
export function classifyDistance(
    distanceMeters: number,
    bleRange = 30,
    maxRange = 5000,
): PresenceStatus {
    if (distanceMeters <= bleRange) return 'nearby';
    if (distanceMeters <= maxRange) return 'in_range';
    return 'out_of_range';
}

/**
 * Human-readable distance formatting.
 */
export function formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)}m`;
    return `${(meters / 1000).toFixed(1)}km`;
}

// ─── Nearby Filtering ───────────────────────────────────────────────────────

export interface ProfileLocation {
    profileId: string;
    location: GeoPoint;
}

/**
 * Find profiles within a given radius of a position, sorted by distance.
 */
export function findNearby(
    myPosition: GeoPoint,
    candidates: ProfileLocation[],
    maxRadiusMeters = 5000,
    bleRangeMeters = 30,
): PresenceRecord[] {
    return candidates
        .map((c) => {
            const dist = calculateDistance(myPosition, c.location);
            return {
                profileId: c.profileId,
                location: c.location,
                distanceMeters: Math.round(dist),
                distanceLabel: formatDistance(dist),
                status: classifyDistance(dist, bleRangeMeters, maxRadiusMeters),
            };
        })
        .filter((r) => r.distanceMeters <= maxRadiusMeters)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

// ─── Consent ────────────────────────────────────────────────────────────────

export function createConsent(
    profileId: string,
    opts: Partial<Pick<LocationConsent, 'locationTracking' | 'bleDiscovery'>> = {},
): LocationConsent {
    return {
        profileId,
        locationTracking: opts.locationTracking ?? false,
        bleDiscovery: opts.bleDiscovery ?? false,
        grantedAt: new Date().toISOString(),
    };
}

export function isConsentValid(consent: LocationConsent | null): boolean {
    if (!consent) return false;
    if (consent.revokedAt) return false;
    return consent.locationTracking || consent.bleDiscovery;
}

export function revokeConsent(consent: LocationConsent): LocationConsent {
    return {
        ...consent,
        locationTracking: false,
        bleDiscovery: false,
        revokedAt: new Date().toISOString(),
    };
}
