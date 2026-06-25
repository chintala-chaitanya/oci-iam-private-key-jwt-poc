const fs = require("fs");
const crypto = require("crypto");

const defaults = {
  clientid: "",
  privatecert: "./private_key.pem",
  publiccert: "./public_certificate.crt",
  audience: "https://identity.oraclecloud.com/",
  expiresInSeconds: 3600,
};

function parseArgs(argv) {
  const args = { ...defaults };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];

    if (!Object.prototype.hasOwnProperty.call(args, key)) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    args[key] = key === "expiresInSeconds" ? Number(value) : value;
    index += 1;
  }

  if (!args.clientid) {
    throw new Error("--clientid is required");
  }

  if (!Number.isFinite(args.expiresInSeconds) || args.expiresInSeconds <= 0) {
    throw new Error("--expiresInSeconds must be a positive number");
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node generate-client-assertion-x5t.js [options]

Options:
  --clientid <id>             OAuth client ID used as iss and sub
  --privatecert <path>        Path to private key PEM file
  --publiccert <path>         Path to public certificate PEM file
  --audience <url>            JWT audience
  --expiresInSeconds <secs>   Assertion lifetime in seconds
  --help                      Show this help

Defaults:
  --privatecert ${defaults.privatecert}
  --publiccert ${defaults.publiccert}
  --audience ${defaults.audience}
  --expiresInSeconds ${defaults.expiresInSeconds}`);
}

function base64UrlString(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlJson(value) {
  return base64UrlString(JSON.stringify(value));
}

function pemCertificateToDer(pem) {
  const base64Body = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

  return Buffer.from(base64Body, "base64");
}

function certificateThumbprint(certificatePem) {
  const der = pemCertificateToDer(certificatePem);
  return base64UrlString(crypto.createHash("sha1").update(der).digest());
}

try {
  const args = parseArgs(process.argv.slice(2));
  const privateKey = fs.readFileSync(args.privatecert, "utf8");
  const certificate = fs.readFileSync(args.publiccert, "utf8");
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
    x5t: certificateThumbprint(certificate),
  };

  const payload = {
    iss: args.clientid,
    sub: args.clientid,
    aud: [args.audience],
    iat: now,
    exp: now + args.expiresInSeconds,
  };

  const unsignedToken = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsignedToken)
    .end()
    .sign(privateKey);

  console.log(`${unsignedToken}.${base64UrlString(signature)}`);
} catch (error) {
  console.error(error.message);
  console.error("Run with --help to see usage.");
  process.exit(1);
}
