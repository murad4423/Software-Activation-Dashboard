// The C# client sends ActivationRequestData via PostAsJsonAsync with no explicit
// JsonSerializerOptions, which defaults to JsonSerializerDefaults.Web -> camelCase
// keys (institutionName, machineId, kind, ...) and numeric enums (Kind/Channel).
// This helper reads fields case-insensitively so a future client-side tweak to the
// naming policy doesn't silently break the backend.

export async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function field(obj, name) {
  if (obj == null) return undefined;
  const lower = name.toLowerCase();
  const key = Object.keys(obj).find((k) => k.toLowerCase() === lower);
  return key ? obj[key] : undefined;
}

export function readActivationRequest(body) {
  return {
    institutionName: field(body, 'institutionName') || '',
    address: field(body, 'address') || '',
    userName: field(body, 'userName') || '',
    phoneNumber: field(body, 'phoneNumber') || '',
    email: field(body, 'email') || '',
    machineId: field(body, 'machineId') || '',
    kind: Number(field(body, 'kind') ?? 0), // 0 = Trial, 1 = Final
    channel: Number(field(body, 'channel') ?? 0), // 0 = Online, 1 = Offline
    requestId: field(body, 'requestId') || '',
    appVersion: field(body, 'appVersion') || '',
    createdUtc: field(body, 'createdUtc') || new Date().toISOString(),
  };
}

export function jsonResponse(statusCode, obj) {
  return new Response(JSON.stringify(obj), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}
