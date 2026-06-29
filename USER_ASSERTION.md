# OCI IAM Domain User JWT Assertion Example

This document shows how to generate a user JWT assertion for OCI IAM Domain and exchange it at the token endpoint.

User assertion is different from client assertion:

- Client assertion proves the client application's identity.
- User assertion asserts a user identity and requests a token in that user's context.

Use this flow carefully. A signed user assertion allows a trusted client to request tokens for an asserted user without that user interactively signing in for the token request. This should be limited to tightly controlled trusted integrations, service accounts, or service-user scenarios where the client is explicitly authorized to assert those users.

## Prerequisites

- Node.js
- OpenSSL
- OCI IAM Domain access
- A confidential application in OCI IAM Domain
- JWT Assertion grant type enabled on the confidential application
- The signing certificate uploaded to the OAuth client certificate keystore
- The certificate alias attached to the confidential application

Refer to [README.md](README.md) for confidential application creation, certificate keystore upload, and certificate alias attachment steps.

## JWT Claims

For user assertion:

```text
iss = OAuth client ID
sub = username
aud = https://identity.oraclecloud.com/
iat = issued-at time
nbf = not-before time
exp = expiration time
jti = unique JWT ID
```

The JWT header includes:

```text
alg = RS256
typ = JWT
kid = certificate alias attached to the app
```

OCI supports using `kid` or `x5t` to identify the signing certificate. This example uses `kid` because the confidential app references certificates by alias, and the JWT `kid` must match the attached certificate alias.

The important difference from client assertion is `sub`:

```text
client assertion: sub = client ID
user assertion:   sub = username
```

## Generate The User Assertion

```bash
node generate-user-assertion.js \
  --certname public_certificate_1.crt \
  --clientid <client_id> \
  --username <username> \
  --privatekey ./private_key_1.pem
```

Show help:

```bash
node generate-user-assertion.js --help
```

Available flags:

```text
--certname <name>           Certificate alias used as JWT kid
--clientid <id>             OAuth client ID used as iss
--username <name>           User name used as sub
--privatekey <path>         Path to private key PEM file
--audience <url>            JWT audience
--expiresInSeconds <secs>   Assertion lifetime in seconds
```

`--clientid` and `--username` are required. The other flags have defaults:

```text
--certname public_certificate_1.crt
--privatekey ./private_key_1.pem
--audience https://identity.oraclecloud.com/
--expiresInSeconds 3600
```

The default audience is `https://identity.oraclecloud.com/`. If your IAM Domain expects the domain URL as the audience, pass it explicitly:

```bash
--audience https://<domain>.identity.oraclecloud.com/
```

## Token Request

The user assertion is sent as `assertion`, not `client_assertion`. The confidential client must still authenticate to the token endpoint. That client authentication can use either a client secret or a JWT client assertion.

### Option 1: Client Secret Authentication

Use HTTP Basic authentication with `base64(client_id:client_secret)`.

```bash
USER_ASSERTION=$(node generate-user-assertion.js \
  --certname public_certificate_1.crt \
  --clientid <client_id> \
  --username <username> \
  --privatekey ./private_key_1.pem)

curl -X POST "https://<domain>.identity.oraclecloud.com/oauth2/v1/token" \
  -H "Authorization: Basic <base64_client_id_colon_client_secret>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  --data-urlencode "assertion=$USER_ASSERTION" \
  --data-urlencode "scope=<scope>"
```

### Option 2: JWT Client Assertion Authentication

Use this option when the confidential client authenticates with a signed client assertion instead of a client secret.

```bash
CLIENT_ASSERTION=$(node generate-client-assertion.js \
  --certname public_certificate_1.crt \
  --clientid <client_id> \
  --privatekey ./private_key_1.pem)

USER_ASSERTION=$(node generate-user-assertion.js \
  --certname public_certificate_1.crt \
  --clientid <client_id> \
  --username <username> \
  --privatekey ./private_key_1.pem)

curl -X POST "https://<domain>.identity.oraclecloud.com/oauth2/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  --data-urlencode "assertion=$USER_ASSERTION" \
  --data-urlencode "client_id=<client_id>" \
  --data-urlencode "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  --data-urlencode "client_assertion=$CLIENT_ASSERTION" \
  --data-urlencode "scope=<scope>"
```

Successful response:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Refresh tokens can be returned for user-context flows when the application and requested scopes allow it, for example when requesting `offline_access`. Client credentials flows, including client credentials with JWT client assertion, normally return an access token only because there is no user session to refresh.

## Refresh The Access Token

Use the same token endpoint with `grant_type=refresh_token`.

If the client uses a client secret:

```bash
curl -X POST "https://<domain>.identity.oraclecloud.com/oauth2/v1/token" \
  -H "Authorization: Basic <base64_client_id_colon_client_secret>" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=<refresh_token>"
```

If the client uses JWT client assertion instead of a client secret:

```bash
CLIENT_ASSERTION=$(node generate-client-assertion.js \
  --certname public_certificate_1.crt \
  --clientid <client_id> \
  --privatekey ./private_key_1.pem)

curl -X POST "https://<domain>.identity.oraclecloud.com/oauth2/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=<refresh_token>" \
  --data-urlencode "client_id=<client_id>" \
  --data-urlencode "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  --data-urlencode "client_assertion=$CLIENT_ASSERTION"
```

## Note: Authorization Code Flow

JWT client assertion is used to authenticate the confidential client at the token endpoint. This is separate from the JWT Assertion grant type used earlier in this document for the user assertion flow. The same client authentication mechanism can also be used in other token endpoint exchanges where the confidential client must authenticate.

For example, in the OAuth Authorization Code flow, the user first authenticates at the authorize endpoint and the application receives an authorization code. The application then exchanges that code at the token endpoint. During that token exchange, the client commonly authenticates with `client_id` and `client_secret`, but it can also authenticate with JWT client assertion.

```bash
CLIENT_ASSERTION=$(node generate-client-assertion.js \
  --certname public_certificate_1.crt \
  --clientid <client_id> \
  --privatekey ./private_key_1.pem)

curl -X POST "https://<domain>.identity.oraclecloud.com/oauth2/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "redirect_uri=<redirect_uri>" \
  --data-urlencode "code=<authorization_code>" \
  --data-urlencode "client_id=<client_id>" \
  --data-urlencode "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  --data-urlencode "client_assertion=$CLIENT_ASSERTION"
```

## Security Notes

- Use user assertion only for trusted integrations, service accounts, or service-user scenarios where this behavior is explicitly intended.
- Keep assertion lifetime short.
- Protect private keys carefully.
- Ensure the asserted user and requested scopes are tightly controlled.
- Review audit logs for token issuance and usage.
