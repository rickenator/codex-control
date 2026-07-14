export function normalizeMobileBridgePort(value: unknown) {
  const port = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('The mobile bridge port must be an integer from 1 to 65535.');
  }
  return port;
}

export function normalizeMobileBridgePublicUrl(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The mobile bridge URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('The mobile bridge URL must be credential-free HTTPS.');
  }
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function createMobilePairingUri(endpointValue: unknown, tokenValue: unknown) {
  const endpoint = normalizeMobileBridgePublicUrl(endpointValue);
  if (!endpoint) throw new Error('An HTTPS mobile URL is required to create a pairing code.');
  const token = typeof tokenValue === 'string' ? tokenValue.trim() : '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('The mobile pairing token is invalid.');

  const pairing = new URL('consiglio://pair/v1');
  pairing.searchParams.set('endpoint', endpoint);
  pairing.searchParams.set('token', token);
  return pairing.toString();
}
