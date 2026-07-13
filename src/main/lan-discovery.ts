import net from 'net';

interface DiscoveredProvider {
  id: string;
  name: string;
  host: string;
  port: number;
}

const DISCOVERY_TIMEOUT_MS = 5000;
const PROBE_TIMEOUT_MS = 800;
const CONCURRENT_PROBES = 64;
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

  // Scan common LAN subnets for llama.cpp ports
  const subnetPrefixes = ['192.168.1.', '10.0.0.', '172.16.'];
  const hosts: string[] = [];
  for (const prefix of subnetPrefixes) {
    for (let i = 1; i <= 254; i += 10) {
      hosts.push(`${prefix}${i}`);
    }
  }

  // Parallel probe with concurrency limit
  let inFlight = 0;
  const queue: Array<() => Promise<void>> = [];

  for (const host of hosts) {
    for (const port of LLAMA_CPP_PORTS) {
      queue.push(async () => {
        inFlight += 1;
        try {
          const open = await probePort(host, port);
          if (open) {
            const key = `${host}:${port}`;
            if (!discovered.has(key)) {
              discovered.set(key, {
                id: `auto-${key}`,
                name: `llama.cpp (${host})`,
                host,
                port,
              });
            }
          }
        } catch { /* skip */ }
        finally {
          inFlight -= 1;
        }
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
