export interface PairingConfig {
  endpoint: string;
  token: string;
}

export function normalizePairingConfig(config: PairingConfig): PairingConfig {
  const endpoint = new URL(config.endpoint.trim());
  const local = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1';
  if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) {
    throw new Error('Use an HTTPS bridge URL. Plain HTTP is allowed only for local development.');
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('The bridge URL must not contain credentials.');
  }
  endpoint.hash = '';
  endpoint.pathname = endpoint.pathname.replace(/\/$/, '');

  const token = config.token.trim();
  if (token.length < 32) throw new Error('The pairing token must contain at least 32 characters.');
  return { endpoint: endpoint.toString().replace(/\/$/, ''), token };
}
