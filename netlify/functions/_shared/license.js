// Signs license payloads the SAME way the C# client (LicenseValidator.cs) verifies them.
//
// CRITICAL — do not "clean up" the casing below. The client does:
//   var payload = JsonSerializer.Deserialize<LicensePayload>(signed.PayloadJson);
// with NO JsonSerializerOptions passed in. Plain System.Text.Json is case-SENSITIVE
// and has no naming policy, so the JSON keys must be exactly PascalCase, matching the
// C# property names in LicenseModels.cs -> LicensePayload:
//   LicenseId, MachineId, Kind, IssuedUtc, ExpiryUtc, InstitutionName
// And RequestKind is a plain enum (no JsonStringEnumConverter), so "Kind" must be the
// numeric value: Trial = 0, Final = 1.
//
// This is DIFFERENT from the outer request/response objects (ActivationRequestData /
// ActivationApiResponse), which travel through PostAsJsonAsync/ReadFromJsonAsync and
// therefore use JsonSerializerDefaults.Web (camelCase, case-insensitive) — see the
// individual function files for those.

import crypto from 'node:crypto';

export const KIND = { Trial: 0, Final: 1 };

function getPrivateKeyPem() {
  // Stored directly as the raw PEM string (no base64) to save space. If the PEM was
  // pasted with literal "\n" escape sequences instead of real newlines (common when
  // copying a single-line value into a form field), convert them back.
  const pem = process.env.LICENSE_PRIVATE_KEY;
  if (!pem) {
    throw new Error(
      'LICENSE_PRIVATE_KEY env var is not set (plain PEM RSA private key, ' +
      'the one whose matching public key is embedded in LicenseValidator.cs).'
    );
  }
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

/**
 * Builds and signs a LicensePayload. Returns the packed "License Key" string in the
 * exact format SignedLicense.ToLicenseKeyString() / SignedLicense.TryParse() expect:
 *   base64(payloadJsonUtf8) + "." + base64(signature)
 */
export function signLicense({ licenseId, machineId, kind, issuedUtc, expiryUtc, institutionName }) {
  const payload = {
    LicenseId: licenseId,
    MachineId: machineId,
    Kind: kind === 'Final' ? KIND.Final : kind === 'Trial' ? KIND.Trial : kind, // accept string or number
    IssuedUtc: issuedUtc.toISOString(),
    ExpiryUtc: expiryUtc.toISOString(),
    InstitutionName: institutionName || '',
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBytes = Buffer.from(payloadJson, 'utf8');

  const privateKey = getPrivateKeyPem();
  // .NET: rsa.VerifyData(bytes, sig, SHA256, RSASignaturePadding.Pkcs1)
  // Node's default RSA padding for crypto.sign with an RSA key is PKCS#1 v1.5, which matches.
  const signature = crypto.sign('sha256', payloadBytes, {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });

  const payloadB64 = payloadBytes.toString('base64');
  const signatureB64 = signature.toString('base64');
  return `${payloadB64}.${signatureB64}`;
}
