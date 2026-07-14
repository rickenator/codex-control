import { Capacitor, registerPlugin } from '@capacitor/core';

import { normalizePairingConfig, type PairingConfig } from './pairing-config';

interface SecurePairingPlugin {
  save(config: PairingConfig): Promise<void>;
  load(): Promise<Partial<PairingConfig>>;
  clear(): Promise<void>;
}

const SecurePairing = registerPlugin<SecurePairingPlugin>('SecurePairing');

export async function savePairing(config: PairingConfig) {
  if (!Capacitor.isNativePlatform()) return;
  await SecurePairing.save(normalizePairingConfig(config));
}

export async function loadPairing(): Promise<PairingConfig | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const saved = await SecurePairing.load();
  if (!saved.endpoint || !saved.token) return null;
  return normalizePairingConfig({ endpoint: saved.endpoint, token: saved.token });
}

export async function clearPairing() {
  if (!Capacitor.isNativePlatform()) return;
  await SecurePairing.clear();
}
