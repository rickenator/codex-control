import net from 'net';

interface DiscoveredProvider {
  id: string;
  name: string;
  host: string;
  port: number;
}

const DISCOVERY_TIMEOUT_MS = 5000;
const LLAMA_CPP_PORTS = [8080, 8081, 8082, 11434];

async function probePort(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection(port, host, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(1500);
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
  for (const prefix of subnetPrefixes) {
    for (let i = 1; i <= 254; i += 10) {
      const host = `${prefix}${i}`;
      for (const port of LLAMA_CPP_PORTS) {
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
      }
    }
  }

  return [...discovered.values()];
}

export { discoverLlamaCppServers, type DiscoveredProvider };
