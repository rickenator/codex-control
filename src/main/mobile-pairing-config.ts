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
