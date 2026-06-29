const fs = require("fs");
const crypto = require("crypto");

const defaults = {
  certname: "public_certificate_1.crt",
  clientid: "",
  username: "",
  privatekey: "./private_key_1.pem",
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

  if (!Number.isFinite(args.expiresInSeconds) || args.expiresInSeconds <= 0) {
    throw new Error("--expiresInSeconds must be a positive number");
  }

  if (!args.clientid) {
    throw new Error("--clientid is required");
  }

  if (!args.username) {
    throw new Error("--username is required");
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node generate-user-assertion.js [options]

Options:
  --certname <name>           Certificate alias used as JWT kid
  --clientid <id>             OAuth client ID used as iss
  --username <name>           User name used as sub
  --privatekey <path>         Path to private key PEM file
  --audience <url>            JWT audience
  --expiresInSeconds <secs>   Assertion lifetime in seconds
  --help                      Show this help

Defaults:
  --certname ${defaults.certname}
  --privatekey ${defaults.privatekey}
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

try {
  const args = parseArgs(process.argv.slice(2));
  const privateKey = fs.readFileSync(args.privatekey, "utf8");
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: args.certname,
  };

  const payload = {
    iss: args.clientid,
    sub: args.username,
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
