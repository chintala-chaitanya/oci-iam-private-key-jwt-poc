# Zero-Downtime JWT Client Assertion Certificate Rotation in OCI IAM Domain

OAuth client credentials with a shared client secret is simple, but it is not always the model customers want for external integrations. In some environments, especially integrations with strict key ownership requirements, the consuming system wants to own the private key and avoid exchanging a shared secret with the API provider.

OCI IAM Domain supports this model using JWT client assertion, commonly referred to as `private_key_jwt`. The client signs a JWT with its private key, OCI IAM Domain validates the JWT with the public certificate associated with the confidential application, and the token endpoint issues an access token.

The basic flow is well documented. The more interesting question is operational:

How do we rotate the signing certificate without downtime?

This post walks through the working pattern.

## What Is JWT Client Assertion?

JWT client assertion is a way for a confidential OAuth client to authenticate to the token endpoint without sending a client secret.

Instead of this:

```text
client_id=<client_id>
client_secret=<client_secret>
```

the client sends:

```text
client_id=<client_id>
client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
client_assertion=<signed_jwt>
```

The signed JWT contains claims like:

```json
{
  "iss": "<client_id>",
  "sub": "<client_id>",
  "aud": ["https://<domain>.identity.oraclecloud.com/"],
  "iat": 1780000000,
  "nbf": 1780000000,
  "exp": 1780003600,
  "jti": "<unique_id>"
}
```

The JWT header identifies the signing certificate:

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "public_certificate_1.crt"
}
```

OCI supports `kid` or `x5t` to identify the certificate. This example uses `kid` because the confidential application references certificate aliases, and the JWT `kid` must match the alias attached to the app.

## The Use Case: Certificate Rotation

For a one-time setup, a single certificate is enough:

```text
Private Key 1 signs the JWT
Public Certificate 1 validates the JWT
```

For rotation, we need a transition window:

```text
Private Key 1 -> Public Certificate 1
Private Key 2 -> Public Certificate 2
```

During that window, both assertions should work:

```text
kid=public_certificate_1.crt signed by private_key_1.pem
kid=public_certificate_2.crt signed by private_key_2.pem
```

After cutover, only certificate 2 should remain active.

## Understanding The UI Path And The Keystore Model

The confidential application UI provides a certificate upload flow, which is useful for a simple single-certificate setup. In a rotation scenario, however, uploading another certificate through that UI flow can appear to replace the current certificate reference on the app.

For an overlapping rotation window, it helps to work with the keystore and app certificate-alias model directly.

The working model is to use the lower-level API:

1. Upload certificates to the OAuth client certificate keystore.
2. PATCH the confidential app so it references the certificate aliases.
3. During rotation, attach both aliases to the same app.
4. After cutover, replace the app's certificate list with only the active alias.

This gives us a single confidential application with an old/new certificate overlap window.

## Step 1: Generate Key Pair And Certificate

Generate the first private key:

```bash
openssl genrsa -out private_key_1.pem 2048
```

Generate the first public certificate:

```bash
openssl req -new -x509 \
  -key private_key_1.pem \
  -out public_certificate_1.crt \
  -days 365 \
  -subj "/CN=oci-iam-jwt-assertion-1"
```

Generate the second pair for rotation:

```bash
openssl genrsa -out private_key_2.pem 2048

openssl req -new -x509 \
  -key private_key_2.pem \
  -out public_certificate_2.crt \
  -days 365 \
  -subj "/CN=oci-iam-jwt-assertion-2"
```

Keep the private keys private. Only the certificates are uploaded to OCI IAM Domain.

## Step 2: Configure The Confidential Application

In OCI Console:

1. Open the target IAM Domain.
2. Create or open a confidential application.
3. Edit the OAuth configuration.
4. Select `Configure this application as a client now`.
5. Set the client type to `Trusted`.
6. Enable the Client Credentials grant type.
7. If you want to validate the returned access token by calling the users API, add the `User Administrator` app role to the confidential application.
8. Activate the application.
9. Copy the OAuth client ID and application ID.

For API calls in the next steps, use an admin access token that can call `/admin/v1` APIs.

```text
HOST=https://<domain>.identity.oraclecloud.com
APP_ID=<confidential_app_id>
CLIENT_ID=<oauth_client_id>
ACCESS_TOKEN=<admin_access_token_for_calling_admin_v1_apis>
```

The examples below use `Content-Type: application/json` for admin API requests because that works cleanly from Postman. Oracle's REST API examples commonly show `Content-Type: application/scim+json` for these SCIM-style admin APIs, so use that media type if your environment or tooling requires strict SCIM content types.

## Step 3: Upload Certificates To The Keystore

Convert the certificate to base64 DER:

```bash
CERT_ALIAS=public_certificate_1.crt
CERT_B64=$(openssl x509 -in public_certificate_1.crt -outform DER | openssl base64 -A)
```

Upload it to the OAuth client certificate keystore:

```bash
curl -X POST "$HOST/admin/v1/OAuthClientCertificates" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"schemas\": [
      \"urn:ietf:params:scim:schemas:oracle:idcs:OAuthClientCertificate\"
    ],
    \"certificateAlias\": \"$CERT_ALIAS\",
    \"x509Base64Certificate\": \"$CERT_B64\"
  }"
```

Repeat with `public_certificate_2.crt`:

```bash
CERT_ALIAS=public_certificate_2.crt
CERT_B64=$(openssl x509 -in public_certificate_2.crt -outform DER | openssl base64 -A)

curl -X POST "$HOST/admin/v1/OAuthClientCertificates" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"schemas\": [
      \"urn:ietf:params:scim:schemas:oracle:idcs:OAuthClientCertificate\"
    ],
    \"certificateAlias\": \"$CERT_ALIAS\",
    \"x509Base64Certificate\": \"$CERT_B64\"
  }"
```

Verify the certificates in the keystore:

```bash
curl -X GET "$HOST/admin/v1/OAuthClientCertificates" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

Each certificate alias must be unique. The alias is important because the client assertion JWT uses it as `kid`.

## Step 4: Attach Certificate Aliases To The App

Patch the confidential app to reference the first certificate alias:

```bash
curl -X PATCH "$HOST/admin/v1/Apps/$APP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
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

During rotation, attach the second alias as well:

```bash
curl -X PATCH "$HOST/admin/v1/Apps/$APP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
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
            "certAlias": "public_certificate_2.crt"
          }
        ]
      }
    ]
  }'
```

Verify the certificate aliases attached to the app:

```bash
curl -X GET "$HOST/admin/v1/Apps/$APP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq
```

At this point, the same confidential app can validate assertions signed by either key.

## Step 5: Generate A Client Assertion With Python

The Python script in this repo generates a JWT client assertion:

```bash
python3 -m pip install cryptography
```

```bash
python3 generate-client-assertion.py \
  --certname public_certificate_1.crt \
  --clientid "$CLIENT_ID" \
  --privatekey ./private_key_1.pem
```

For certificate 2:

```bash
python3 generate-client-assertion.py \
  --certname public_certificate_2.crt \
  --clientid "$CLIENT_ID" \
  --privatekey ./private_key_2.pem
```

The script uses `RS256` and includes `iss`, `sub`, `aud`, `iat`, `nbf`, `exp`, and `jti`.

Oracle's client/user assertion documentation says the identity domain URL should be one of the `aud` values. The script default follows the value used in our IDCS-style testing, but you can pass the domain URL explicitly:

```bash
--audience "https://<domain>.identity.oraclecloud.com/"
```

## Step 6: Request An Access Token

Generate an assertion and call the token endpoint:

```bash
CLIENT_ASSERTION=$(python3 generate-client-assertion.py \
  --certname public_certificate_1.crt \
  --clientid "$CLIENT_ID" \
  --privatekey ./private_key_1.pem)

curl -X POST "$HOST/oauth2/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=urn:opc:idm:__myscopes__" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  --data-urlencode "client_assertion=$CLIENT_ASSERTION"
```

Repeat with certificate 2. During the rotation window, both should return access tokens.

## Step 7: Validate The Access Token

Getting a token proves that OCI IAM Domain accepted the JWT client assertion. For a stronger end-to-end test, call an API with that token.

If the confidential application has the `User Administrator` app role, you can call the users endpoint:

```bash
ACCESS_TOKEN_FROM_ASSERTION=<access_token_from_token_response>

curl -X GET "$HOST/admin/v1/Users?count=5" \
  -H "Authorization: Bearer $ACCESS_TOKEN_FROM_ASSERTION"
```

This confirms that:

```text
Private key signed the JWT assertion
OCI IAM Domain validated the assertion using the attached certificate alias
OCI IAM Domain issued an access token
The access token can call an authorized API
```

## Step 8: Complete The Rotation

After the client has moved to certificate 2, replace the app's `certificates` list with only the active alias:

```bash
curl -X PATCH "$HOST/admin/v1/Apps/$APP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schemas": [
      "urn:ietf:params:scim:api:messages:2.0:PatchOp"
    ],
    "Operations": [
      {
        "op": "replace",
        "path": "certificates",
        "value": [
          {
            "certAlias": "public_certificate_2.crt"
          }
        ]
      }
    ]
  }'
```

Optionally delete the old certificate from the keystore. Use the keystore verification command above to find the certificate resource ID:

```bash
curl -X DELETE "$HOST/admin/v1/OAuthClientCertificates/<oAuthClientCertificateId>" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## User Assertion Addendum

JWT client assertion is used to authenticate the confidential client at the token endpoint. The same client authentication mechanism can be used in other token endpoint exchanges too.

For example, in the JWT user assertion grant, the confidential application must have the JWT Assertion grant type enabled. The user assertion is sent as `assertion`, while the client can authenticate using JWT client assertion.

```text
grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
assertion=<user_assertion_jwt>
client_assertion=<client_assertion_jwt>
```

In this flow:

```text
user assertion:   sub = username
client assertion: sub = client ID
```

Use user assertion carefully. A signed user assertion allows a trusted client to request tokens for an asserted user without that user interactively signing in for the token request. This should be limited to tightly controlled trusted integrations, service accounts, or service-user scenarios where the client is explicitly authorized to assert those users.

This repo includes a Python helper:

```bash
python3 generate-user-assertion.py \
  --certname public_certificate_1.crt \
  --clientid "$CLIENT_ID" \
  --username "<username>" \
  --privatekey ./private_key_1.pem
```

An end-to-end token request using user assertion plus JWT client assertion looks like this:

```bash
CLIENT_ASSERTION=$(python3 generate-client-assertion.py \
  --certname public_certificate_1.crt \
  --clientid "$CLIENT_ID" \
  --privatekey ./private_key_1.pem)

USER_ASSERTION=$(python3 generate-user-assertion.py \
  --certname public_certificate_1.crt \
  --clientid "$CLIENT_ID" \
  --username "<username>" \
  --privatekey ./private_key_1.pem)

curl -X POST "$HOST/oauth2/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  --data-urlencode "assertion=$USER_ASSERTION" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  --data-urlencode "client_assertion=$CLIENT_ASSERTION" \
  --data-urlencode "scope=<scope>"
```

If you request `offline_access` and the application policy allows it, user-context flows can return a refresh token. Client credentials flows normally return only an access token because there is no user session to refresh.

## Conclusion

JWT client assertion removes the need for shared client secrets, but certificate rotation is where the operational details matter.

For zero-downtime rotation in OCI IAM Domain, use the keystore and app PATCH APIs:

```text
POST  /admin/v1/OAuthClientCertificates
PATCH /admin/v1/Apps/{appId}
```

Attach both old and new certificate aliases during the rotation window, make sure the JWT `kid` matches the active alias, and then replace the app's certificate list after cutover.

That gives you customer-managed signing keys, no shared client secret, and a clean rotation path with one confidential application.
