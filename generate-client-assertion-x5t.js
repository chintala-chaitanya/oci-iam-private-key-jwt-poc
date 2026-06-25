const fs = require("fs");
const crypto = require("crypto");

const clientId = "a8e97dbd23eb49ee8d26f7b554f8ee7f";

const certs = {
  cert1: {
    certificatePath: "./public_certificate.crt",
    privateKeyPath: "./private_key.pem",
  },
  cert2: {
    certificatePath: "./public_certificate_2.crt",
    privateKeyPath: "./private_key_2.pem",
  },
};

const selectedCertName = process.argv[2] || "cert1";
const selectedCert = certs[selectedCertName];

if (!selectedCert) {
  console.error(`Unknown certificate: ${selectedCertName}`);
  console.error(`Use one of: ${Object.keys(certs).join(", ")}`);
  process.exit(1);
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

const privateKey = fs.readFileSync(selectedCert.privateKeyPath, "utf8");
const certificate = fs.readFileSync(selectedCert.certificatePath, "utf8");
const now = Math.floor(Date.now() / 1000);

const header = {
  alg: "RS256",
  typ: "JWT",
  x5t: certificateThumbprint(certificate),
};

const payload = {
  iss: clientId,
  sub: clientId,
  aud: ["https://identity.oraclecloud.com/"],
  iat: now,
  exp: now + 3600,
};

const unsignedToken = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;

const signature = crypto
  .createSign("RSA-SHA256")
  .update(unsignedToken)
  .end()
  .sign(privateKey);

const jwt = `${unsignedToken}.${base64UrlString(signature)}`;

console.log(jwt);
