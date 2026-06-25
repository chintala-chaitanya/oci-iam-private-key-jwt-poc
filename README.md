# OCI IAM Domain JWT Assertion POC

This POC shows how to authenticate an OAuth confidential application in OCI IAM Domain using a JWT client assertion signed with a private key. This OAuth client authentication method is commonly referred to as `private_key_jwt`.

The goal is to avoid shared client secrets. The client owns the private key, OCI IAM Domain stores the public certificate, and the token endpoint validates the signed JWT assertion before issuing an access token.

## What Is JWT Client Assertion?

A JWT client assertion is a signed JWT sent to the token endpoint as proof of the client's identity. In OAuth, the `private_key_jwt` client authentication method uses this JWT assertion instead of a shared client secret.

The JWT assertion contains:

- `iss`: OAuth client ID
- `sub`: OAuth client ID
- `aud`: token audience, usually `https://identity.oraclecloud.com/`
- `iat`: issued-at timestamp
- `exp`: expiration timestamp

The JWT header contains:

- `alg`: `RS256`
- `typ`: `JWT`
- `kid`: certificate alias configured in OCI IAM Domain

OCI IAM Domain validates the JWT signature using the public certificate uploaded to the confidential application.

## Prerequisites

- Node.js
- OpenSSL
- OCI IAM Domain access
- A confidential application in OCI IAM Domain

## Generate A Private Key

```bash
openssl genrsa -out private_key.pem 2048
```

Keep this private key secure. Do not upload it to OCI and do not commit it to Git.

## Generate A Public Certificate

```bash
openssl req -new -x509 \
  -key private_key.pem \
  -out public_certificate.crt \
  -days 365 \
  -subj "/CN=oci-iam-jwt-assertion-poc"
```

Verify the certificate:

```bash
openssl x509 -in public_certificate.crt -text -noout
```

## Configure OCI IAM Domain

1. Open OCI Console.
2. Go to Identity & Security.
3. Open the target IAM Domain.
4. Create or open a Confidential Application.
5. Enable the Client Credentials grant type.
6. Enable JWT assertion/client assertion authentication if shown.
7. Upload `public_certificate.crt`.
8. Set the certificate alias/name, for example:

```text
client-cert
```

9. Add the `User Administrator` app role if you want to test the token against the users API.
10. Activate the application.
11. Copy the OAuth client ID.

## Generate The JWT Assertion

Generate a JWT assertion:

```bash
node generate-client-assertion.js \
  --certname client-cert \
  --clientid <client_id> \
  --privatecert ./private_key.pem
```

Show help:

```bash
node generate-client-assertion.js --help
```

Available flags:

```text
--certname <name>           Certificate alias used as JWT kid
--clientid <id>             OAuth client ID used as iss and sub
--privatecert <path>        Path to private key PEM file
--audience <url>            JWT audience
--expiresInSeconds <secs>   Assertion lifetime in seconds
```

`--clientid` is required. The other flags have defaults.

## Request An Access Token

```bash
JWT=$(node generate-client-assertion.js \
  --certname client-cert \
  --clientid <client_id> \
  --privatecert ./private_key.pem)

curl -X POST "https://<domain>.identity.oraclecloud.com/oauth2/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=urn:opc:idm:__myscopes__" \
  --data-urlencode "client_id=<client_id>" \
  --data-urlencode "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  --data-urlencode "client_assertion=$JWT"
```

Successful response:

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

## Test The Access Token

```bash
curl -X GET "https://<domain>.identity.oraclecloud.com/admin/v1/Users?count=5" \
  -H "Authorization: Bearer <access_token>" \
  -H "Accept: application/scim+json"
```

The confidential application must have the required privileges to call the API. For the users API test above, assign the `User Administrator` app role to the confidential application.

## Key Rotation Finding

The base JWT assertion / `private_key_jwt` authentication flow works with OCI IAM Domain.

In testing, the standard confidential application certificate configuration supported one active client assertion certificate at a time. Uploading a second certificate replaced the first certificate. Uploading a PEM bundle containing two certificates was rejected.

Because of that, overlapping key rotation with two simultaneously valid certificates was not achievable through the tested single-app certificate upload flow.

If zero-downtime rotation is required, use two confidential applications during the transition window:

- `client-app-v1` configured with certificate 1
- `client-app-v2` configured with certificate 2

During rotation, allow both clients to access the APIs. After the customer fully switches to the new application and certificate, decommission the old application.

## Security Notes

- Never commit private keys.
- Never share private keys with OCI or downstream services.
- Keep assertion expiration short.
- Rotate certificates according to the agreed operational policy.
- Store production private keys in a secure key management system.
