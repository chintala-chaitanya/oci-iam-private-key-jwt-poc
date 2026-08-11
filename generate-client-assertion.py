#!/usr/bin/env python3
import argparse
import base64
import json
import time
import uuid

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


def base64_url_encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def json_base64_url_encode(value):
    return base64_url_encode(
        json.dumps(value, separators=(",", ":")).encode("utf-8")
    )


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate an OCI IAM Domain JWT client assertion."
    )
    parser.add_argument(
        "--certname",
        default="public_certificate_1.crt",
        help="Certificate alias used as JWT kid.",
    )
    parser.add_argument(
        "--clientid",
        required=True,
        help="OAuth client ID used as iss and sub.",
    )
    parser.add_argument(
        "--privatekey",
        default="./private_key_1.pem",
        help="Path to private key PEM file.",
    )
    parser.add_argument(
        "--audience",
        default="https://identity.oraclecloud.com/",
        help="JWT audience.",
    )
    parser.add_argument(
        "--expires-in-seconds",
        type=int,
        default=3600,
        help="Assertion lifetime in seconds.",
    )
    return parser.parse_args()


def load_private_key(path):
    with open(path, "rb") as key_file:
        return serialization.load_pem_private_key(key_file.read(), password=None)


def sign_rs256(private_key, signing_input):
    return private_key.sign(
        signing_input.encode("ascii"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )


def main():
    args = parse_args()
    if args.expires_in_seconds <= 0:
        raise SystemExit("--expires-in-seconds must be a positive number")

    now = int(time.time())
    header = {
        "alg": "RS256",
        "typ": "JWT",
        "kid": args.certname,
    }
    payload = {
        "iss": args.clientid,
        "sub": args.clientid,
        "aud": [args.audience],
        "iat": now,
        "nbf": now,
        "exp": now + args.expires_in_seconds,
        "jti": str(uuid.uuid4()),
    }

    signing_input = f"{json_base64_url_encode(header)}.{json_base64_url_encode(payload)}"
    signature = sign_rs256(load_private_key(args.privatekey), signing_input)
    print(f"{signing_input}.{base64_url_encode(signature)}")


if __name__ == "__main__":
    main()
