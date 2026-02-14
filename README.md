# Proximity Service

Consent-based GPS + BLE proximity detection microservice. Part of the [Berlin AI Automation Studio](../RULES.md) ecosystem.

## Features

- **Distance Calculation**: Haversine great-circle distance between any two GeoPoints
- **Nearby Filtering**: Find profiles within a radius, sorted by distance
- **Consent Management**: GDPR-compliant create/validate/revoke consent records
- **OpenAPI Manifest**: Full spec at `/api/openapi.json`
- **Stateless**: No data persistence — all calculations are ephemeral

## Quick Start

```bash
npm install
npm run dev
```

## API

| Method | Route | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/openapi.json` | OpenAPI 3.0 spec |
| `GET` | `/api/proximity/status` | Service capabilities |
| `POST` | `/api/proximity/calculate` | Distance between two points |
| `POST` | `/api/proximity/nearby` | Find nearby profiles |
| `POST` | `/api/proximity/consent` | Consent lifecycle |

## Example

```bash
# Calculate distance between Berlin and Munich
curl -X POST http://localhost:3000/api/proximity/calculate \
  -H "Content-Type: application/json" \
  -d '{"from":{"lat":52.52,"lng":13.405},"to":{"lat":48.1351,"lng":11.582}}'
```

## Deployment

Deployed to Railway via `Dockerfile`. Health check at `/health`.

```
https://proximity-service-production.up.railway.app
```

## Catalog

This service follows the [Berlin AI Studio RULES.md](../RULES.md) and registers with the [Microservices Catalog](../Microservices_Catalog.md).

- **Catalog Entry**: [Microservices_Catalog.md](../Microservices_Catalog.md)
