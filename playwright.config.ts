import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    retries: 0,
    use: {
        baseURL: process.env.BASE_URL || 'https://proximity-service-production-87bc.up.railway.app',
        extraHTTPHeaders: {
            'X-API-Key': process.env.PROXIMITY_API_KEY || '',
        },
    },
    reporter: [['list'], ['html', { open: 'never' }]],
});
