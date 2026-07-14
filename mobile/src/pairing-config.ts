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

export function parsePairingUri(value: string): PairingConfig {
  if (value.length > 4_096) throw new Error('The pairing code is too large.');
  let pairing: URL;
  try {
    pairing = new URL(value.trim());
  } catch {
    throw new Error('This is not a Consiglio pairing code.');
  }
  if (pairing.protocol !== 'consiglio:' || pairing.hostname !== 'pair' || pairing.pathname !== '/v1' || pairing.hash) {
    throw new Error('This is not a supported Consiglio pairing code.');
  }
  const keys = [...pairing.searchParams.keys()];
  if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes('endpoint') || !keys.includes('token')) {
    throw new Error('The Consiglio pairing code has unexpected fields.');
  }
  const config = normalizePairingConfig({
    endpoint: pairing.searchParams.get('endpoint') || '',
    token: pairing.searchParams.get('token') || '',
  });
  if (!/^[a-f0-9]{64}$/.test(config.token)) throw new Error('The QR pairing token is invalid.');
  return config;
}
