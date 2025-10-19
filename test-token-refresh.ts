/**
 * Test script to determine correct Content-Type for Podio token refresh
 * Run with: npx tsx test-token-refresh.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

async function testRefreshWithJson(clientId: string, clientSecret: string, refreshToken: string) {
  console.log('\n========================================');
  console.log('Testing with Content-Type: application/json');
  console.log('========================================');

  const response = await fetch('https://api.podio.com/oauth/token/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  console.log('Status:', response.status);
  console.log('Status Text:', response.statusText);

  const text = await response.text();
  console.log('Response Body:', text);

  return response.ok;
}

async function testRefreshWithFormEncoded(clientId: string, clientSecret: string, refreshToken: string) {
  console.log('\n========================================');
  console.log('Testing with Content-Type: application/x-www-form-urlencoded');
  console.log('========================================');

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch('https://api.podio.com/oauth/token/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  console.log('Status:', response.status);
  console.log('Status Text:', response.statusText);

  const text = await response.text();
  console.log('Response Body:', text);

  return response.ok;
}

async function main() {
  // Read token from cache
  const tokenPath = join(process.cwd(), 'logs', 'podio-token-cache.json');
  const tokenData = JSON.parse(readFileSync(tokenPath, 'utf-8'));

  const refreshToken = tokenData.tokens.refresh_token;

  // Hard-code credentials for test
  const clientId = 'podio-migration-agent';
  const clientSecret = 'zwAXmUURPMwIxcUK5gtTSSBTwkf2UvYqYDR6QkWbP0DcHLdL6kWipPpXX9n0RzaM';

  console.log('Client ID:', clientId);
  console.log('Refresh Token:', `${refreshToken.substring(0, 10)}...`);

  // Test both formats
  const jsonWorks = await testRefreshWithJson(clientId, clientSecret, refreshToken);
  const formWorks = await testRefreshWithFormEncoded(clientId, clientSecret, refreshToken);

  console.log('\n========================================');
  console.log('RESULTS:');
  console.log('========================================');
  console.log('application/json:', jsonWorks ? '✅ WORKS' : '❌ FAILS');
  console.log('application/x-www-form-urlencoded:', formWorks ? '✅ WORKS' : '❌ FAILS');
}

main().catch(console.error);
