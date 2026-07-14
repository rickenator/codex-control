import net from 'net';
import os from 'os';

interface DiscoveredProvider {
  id: string;
  name: string;
  host: string;
  port: number;
}

const PROBE_TIMEOUT_MS = 300;
const CONCURRENT_PROBES = 128;
const LLAMA_CPP_PORTS = [8080, 8081, 8082, 11434];

async function probePort(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection(port, host, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function discoverLlamaCppServers(): Promise<DiscoveredProvider[]> {
  const discovered = new Map<string, DiscoveredProvider>();
  const subnetPrefixes = new Set<string>();
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const octets = address.address.split('.');
      if (octets.length === 4) subnetPrefixes.add(`${octets[0]}.${octets[1]}.${octets[2]}.`);
    }
  }
  const hosts = ['127.0.0.1'];
  for (const prefix of [...subnetPrefixes].slice(0, 4)) {
    for (let suffix = 1; suffix <= 254; suffix += 1) hosts.push(`${prefix}${suffix}`);
  }

  // Parallel probe with concurrency limit
  const queue: Array<() => Promise<void>> = [];

  for (const host of hosts) {
    for (const port of LLAMA_CPP_PORTS) {
      queue.push(async () => {
        try {
          const open = await probePort(host, port);
          if (open) {
            const key = `${host}:${port}`;
            if (!discovered.has(key)) {
              discovered.set(key, {
                id: `auto-${key}`,
                name: `${port === 11434 ? 'Ollama' : 'llama.cpp'} (${host})`,
                host,
                port,
              });
            }
          }
        } catch { /* skip */ }
      });
    }
  }

  // Process queue in batches of CONCURRENT_PROBES
  for (let i = 0; i < queue.length; i += CONCURRENT_PROBES) {
    const batch = queue.slice(i, i + CONCURRENT_PROBES);
    await Promise.all(batch.map(fn => fn()));
  }

  return [...discovered.values()];
}

export { discoverLlamaCppServers, type DiscoveredProvider };
