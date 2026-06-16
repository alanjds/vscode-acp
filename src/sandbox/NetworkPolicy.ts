import { getSandboxConfig } from './SandboxConfig';
import { log } from '../utils/Logger';

export function isHostAllowed(host: string): boolean {
  const allowlist = getSandboxConfig().networkAllowlist;
  if (allowlist.length === 0) {
    return true;
  }

  const normalizedHost = host.trim().toLowerCase();
  return allowlist.some(entry => {
    const normalizedEntry = entry.trim().toLowerCase();
    if (!normalizedEntry) {
      return false;
    }
    return normalizedHost === normalizedEntry || normalizedHost.endsWith(`.${normalizedEntry}`);
  });
}

export function assertHostAllowed(host: string): void {
  if (!isHostAllowed(host)) {
    throw new Error(`Network host "${host}" is not in acp.sandbox.network.allowlist.`);
  }
}

export function logNetworkPolicyNotice(): void {
  const allowlist = getSandboxConfig().networkAllowlist;
  if (allowlist.length === 0) {
    log('Sandbox network policy: no allowlist configured; agent binaries may access any host.');
    return;
  }
  log(`Sandbox network policy: allowlist active (${allowlist.join(', ')}). Application-level only in v1.`);
}
