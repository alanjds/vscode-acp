import { log, logError } from '../utils/Logger';

interface RegistryAgent {
  name: string;
  description?: string;
  command: string;
  args?: string[];
  homepage?: string;
}

interface Registry {
  agents: RegistryAgent[];
}

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const REGISTRY_TIMEOUT_MS = 30_000;

let cachedRegistry: Registry | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches the ACP agent registry from the CDN.
 * Results are cached for 5 minutes. Times out after 30 seconds.
 */
export async function fetchRegistry(): Promise<RegistryAgent[]> {
  const now = Date.now();
  if (cachedRegistry && (now - cacheTime) < CACHE_TTL) {
    return cachedRegistry.agents;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);

  try {
    log('Fetching ACP agent registry...');
    const response = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as Registry;
    cachedRegistry = data;
    cacheTime = now;
    log(`Registry fetched: ${data.agents?.length || 0} agents`);
    return data.agents || [];
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      logError('Registry fetch timed out after 30s', e);
    } else {
      logError('Failed to fetch registry', e);
    }
    return cachedRegistry?.agents || [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Clear the registry cache.
 */
export function clearRegistryCache(): void {
  cachedRegistry = null;
  cacheTime = 0;
}
