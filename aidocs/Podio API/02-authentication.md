# Podio API Authentication

## Overview
Podio uses OAuth 2.0 for authentication and authorization. All API requests require a valid access token.

## Prerequisites

### Register Your Application
1. Create an API client in Podio to obtain:
   - **Client ID**: Public identifier for your application
   - **Client Secret**: Confidential key (keep secure!)

## OAuth 2.0 Flows

### 1. Server-Side Flow (Recommended)
Best for web applications with a backend server.

#### Step 1: Authorization Request
Redirect user to:
```
https://podio.com/oauth/authorize?
  client_id=YOUR_CLIENT_ID
  &redirect_uri=YOUR_REDIRECT_URI
  &state=RANDOM_STATE_STRING
```

Parameters:
- `client_id`: Your application's client ID
- `redirect_uri`: URL to receive the authorization code
- `state`: Random string to prevent CSRF attacks (validate on callback)

#### Step 2: Handle Callback
User authorizes and Podio redirects to:
```
YOUR_REDIRECT_URI?code=AUTHORIZATION_CODE&state=RANDOM_STATE_STRING
```

#### Step 3: Exchange Code for Token
```http
POST https://api.podio.com/oauth/token/v2
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
&redirect_uri=YOUR_REDIRECT_URI
&code=AUTHORIZATION_CODE
```

### 2. Client-Side Flow
For browser, mobile, or desktop apps without a server.

Authorization request includes `response_type=token` to receive access token directly.

### 3. Username & Password Flow
**Not recommended** for production use.

```http
POST https://api.podio.com/oauth/token/v2
Content-Type: application/x-www-form-urlencoded

grant_type=password
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
&username=USER_EMAIL
&password=USER_PASSWORD
```

### 4. App Authentication Flow
For interactions limited to a single app.

```http
POST https://api.podio.com/oauth/token/v2
Content-Type: application/x-www-form-urlencoded

grant_type=app
&app_id=APP_ID
&app_token=APP_TOKEN
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
```

## Token Response

All successful authentication flows return:
```json
{
  "access_token": "ACCESS_TOKEN",
  "token_type": "bearer",
  "expires_in": 28800,
  "refresh_token": "REFRESH_TOKEN",
  "scope": "GRANTED_SCOPES"
}
```

### Token Lifetimes
- **Access Token**: 8 hours (28,800 seconds)
- **Refresh Token**: 28 days

## Using Access Tokens

Include the access token in all API requests:

```http
GET https://api.podio.com/org/
Authorization: OAuth2 ACCESS_TOKEN
```

### Header Format
```
Authorization: OAuth2 ACCESS_TOKEN
```

## Refreshing Tokens

Before access token expires (or when API returns 401), refresh it:

```http
POST https://api.podio.com/oauth/token/v2
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
&refresh_token=REFRESH_TOKEN
```

Response contains new access_token and refresh_token.

## Best Practices

### Security
1. **Keep Client Secret Confidential**: Never expose in client-side code
2. **Use HTTPS**: All communication must be over HTTPS
3. **Validate State Parameter**: Prevents CSRF attacks
4. **Secure Token Storage**: Store tokens securely (encrypted database, secure keychain)

### Token Management
1. **Refresh Proactively**: Refresh tokens before expiration, not after
2. **Handle Expiration Gracefully**: Implement automatic token refresh on 401 errors
3. **Don't Request New Tokens Per Request**: Reuse access tokens until they expire
4. **Store Refresh Tokens**: Essential for maintaining long-term access

### Flow Selection
1. **Server-side apps**: Use server-side OAuth flow
2. **Single-app integrations**: Use app authentication
3. **Testing/development**: Username & password acceptable, but avoid in production
4. **Client-side apps**: Use client-side flow with token stored securely

## Common Errors

### Invalid Grant
- Authorization code already used or expired
- Refresh token expired (after 28 days)
- Solution: Re-authenticate user

### Unauthorized Client
- Invalid client_id or client_secret
- Solution: Verify credentials in Podio API settings

### Invalid Scope
- Requested scope not available
- Solution: Request appropriate scopes for your use case

## Example Implementation (Node.js)

```javascript
const axios = require('axios');

class PodioAuth {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
  }

  async authenticateWithPassword(username, password) {
    const response = await axios.post('https://api.podio.com/oauth/token/v2',
      new URLSearchParams({
        grant_type: 'password',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        username,
        password
      })
    );

    this.storeTokens(response.data);
    return response.data;
  }

  async refreshAccessToken() {
    const response = await axios.post('https://api.podio.com/oauth/token/v2',
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken
      })
    );

    this.storeTokens(response.data);
    return response.data;
  }

  storeTokens(data) {
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.expiresAt = Date.now() + (data.expires_in * 1000);
  }

  async getValidToken() {
    // Refresh if token expires in next 5 minutes
    if (Date.now() > this.expiresAt - 300000) {
      await this.refreshAccessToken();
    }
    return this.accessToken;
  }

  getAuthHeader() {
    return `OAuth2 ${this.accessToken}`;
  }
}

module.exports = PodioAuth;
```

## Testing Authentication

Quick test to verify authentication:
```bash
curl -H "Authorization: OAuth2 YOUR_ACCESS_TOKEN" \
  https://api.podio.com/org/
```

Should return list of organizations you have access to.
