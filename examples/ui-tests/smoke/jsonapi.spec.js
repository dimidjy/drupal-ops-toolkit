import { expect, test } from '@playwright/test';

test.describe('JSON:API', () => {
  test('lists resources for the decoupled frontend', async ({ request }) => {
    const response = await request.get('/jsonapi');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/vnd.api+json');
    const body = await response.json();
    expect(Object.keys(body.links ?? {})).not.toHaveLength(0);
  });
});
