# OCI IAM Domain JWT Assertion Example

This example shows how to authenticate an OAuth confidential application in OCI IAM Domain using a JWT client assertion signed with a private key. This OAuth client authentication method is commonly referred to as `private_key_jwt`.

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
- `kid`: certificate alias attached to the OCI IAM Domain confidential application

OCI IAM Domain validates the JWT signature using the public certificate stored in the domain keystore and referenced by the confidential application.

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
  -subj "/CN=oci-iam-jwt-assertion"
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
5. Edit the OAuth configuration.
6. Select `Configure this application as a client now`.
7. Set the client type to `Trusted`.
8. Enable the Client Credentials grant type.
9. Enable JWT assertion/client assertion authentication if shown.
10. Add the `User Administrator` app role if you want to test the token against the users API.
11. Activate the application.
12. Copy the OAuth client ID and application ID.

Do not use the confidential application UI certificate upload for rotation testing. In the UI, uploading a new certificate can replace the certificate reference on the app. For certificate rotation, upload certificates to the IAM Domain keystore using the API, then PATCH the confidential app to reference one or more certificate aliases.

## API Variables

The API examples below use these placeholders:

```text
HOST=https://<domain>.identity.oraclecloud.com
APP_ID=<confidential_app_id>
CLIENT_ID=<oauth_client_id>
ACCESS_TOKEN=<admin_access_token_for_calling_admin_v1_apis>
CERT_ALIAS=public_certificate_1.crt
```

For example, an app details endpoint has this shape:

```text
https://<domain>.identity.oraclecloud.com/admin/v1/Apps/<confidential_app_id>
```

## View The Confidential App

```bash
curl -X GET "$HOST/admin/v1/Apps/$APP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/scim+json"
```

## Upload A Certificate To The Keystore

Convert the certificate to base64 DER. Do not include PEM headers or footers.

```bash
CERT_B64=$(openssl x509 -in public_certificate_1.crt -outform DER | openssl base64 -A)
```

Upload the certificate to the OAuth client certificate keystore:

```bash
curl -X POST "$HOST/admin/v1/OAuthClientCertificates" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/scim+json" \
  -H "Accept: application/scim+json" \
  -d "{
    \"schemas\": [
      \"urn:ietf:params:scim:schemas:oracle:idcs:OAuthClientCertificate\"
    ],
    \"certificateAlias\": \"$CERT_ALIAS\",
    \"x509Base64Certificate\": \"$CERT_B64\"
  }"
```

Postman raw JSON body:

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:oracle:idcs:OAuthClientCertificate"
  ],
  "certificateAlias": "public_certificate_1.crt",
  "x509Base64Certificate": "PASTE_BASE64_DER_CERTIFICATE_HERE"
}
```

The `certificateAlias` value is the alias that must be used as the JWT `kid`.

## List Certificates In The Keystore

```bash
curl -X GET "$HOST/admin/v1/OAuthClientCertificates" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/scim+json"
```

## Attach Certificate Aliases To The App

After uploading the certificate to the keystore, PATCH the confidential application to reference the certificate alias.

```bash
curl -X PATCH "$HOST/admin/v1/Apps/$APP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/scim+json" \
  -H "Accept: application/scim+json" \
  -d '{
    "schemas": [
      "urn:ietf:params:scim:api:messages:2.0:PatchOp"
    ],
    "Operations": [
      {
        "op": "add",
        "path": "certificates",
        "value": [
          {
            "certAlias": "public_certificate_1.crt"
          }
        ]
      }
    ]
  }'
```

To attach a second certificate for rotation, upload the second certificate to the keystore with a different alias, then PATCH the app with that alias:

```json
{
  "schemas": [
    "urn:ietf:params:scim:api:messages:2.0:PatchOp"
  ],
  "Operations": [
    {
      "op": "add",
      "path": "certificates",
      "value": [
        {
          "certAlias": "public_certificate_2.crt"
        }
      ]
    }
  ]
}
```

## Remove Old Certificate Aliases From The App

After cutover, remove the old certificate alias from the app by replacing the `certificates` list with only the aliases that should remain active.

For example, to keep only `public_certificate_1.crt` active:

```json
{
  "schemas": [
    "urn:ietf:params:scim:api:messages:2.0:PatchOp"
  ],
  "Operations": [
    {
      "op": "replace",
      "path": "certificates",
      "value": [
        {
          "certAlias": "public_certificate_1.crt"
        }
      ]
    }
  ]
}
```

Use `replace` for this cleanup step so the app ends with an explicit final list of active certificate aliases.

## Delete A Certificate From The Keystore

Use the certificate resource ID returned by `GET /admin/v1/OAuthClientCertificates`.

```bash
curl -X DELETE "$HOST/admin/v1/OAuthClientCertificates/<oAuthClientCertificateId>" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Generate The JWT Assertion

Generate a JWT assertion:

```bash
node generate-client-assertion.js \
  --certname public_certificate_1.crt \
  --clientid <client_id> \
  --privatekey ./private_key_1.pem
```

Show help:

```bash
node generate-client-assertion.js --help
```

Available flags:

```text
--certname <name>           Certificate alias used as JWT kid
--clientid <id>             OAuth client ID used as iss and sub
--privatekey <path>         Path to private key PEM file
--audience <url>            JWT audience
--expiresInSeconds <secs>   Assertion lifetime in seconds
```

`--clientid` is required. The other flags have defaults:

```text
--certname public_certificate_1.crt
--privatekey ./private_key_1.pem
--audience https://identity.oraclecloud.com/
--expiresInSeconds 3600
```

## Request An Access Token

```bash
JWT=$(node generate-client-assertion.js \
  --certname public_certificate_1.crt \
  --clientid <client_id> \
  --privatekey ./private_key_1.pem)

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

In testing, the confidential application UI certificate upload appeared to replace the certificate reference on the app. A PEM bundle containing two certificates was also rejected.

However, OCI IAM Domain stores OAuth client certificates in a keystore and confidential applications can reference certificate aliases from that keystore. By uploading certificates to `/admin/v1/OAuthClientCertificates` and PATCHing the confidential app's `certificates` attribute, multiple certificate aliases can be attached to the same app.

This enables zero-downtime key rotation with one confidential app:

- Upload certificate 1 to the keystore with alias `public_certificate_1.crt`.
- PATCH the app to reference `public_certificate_1.crt`.
- Client signs with private key 1 and sends `kid=public_certificate_1.crt`.
- Upload certificate 2 to the keystore with alias `public_certificate_2.crt`.
- PATCH the same app to also reference `public_certificate_2.crt`.
- During rotation, client assertions signed with either private key can be accepted.
- After cutover, replace the app's `certificates` list with only the active alias and optionally delete the old certificate from the keystore.

The JWT `kid` must match the certificate alias attached to the app.

## Security Notes

- Never commit private keys.
- Never share private keys with OCI or downstream services.
- Keep assertion expiration short.
- Rotate certificates according to the agreed operational policy.
- Store production private keys in a secure key management system.
