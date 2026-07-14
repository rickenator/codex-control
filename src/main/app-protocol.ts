import path from 'path';

export const APP_PROTOCOL = 'consiglio';
export const APP_PROTOCOL_HOST = 'app';

export function isTrustedRendererUrl(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl);
    return url.protocol === `${APP_PROTOCOL}:` && url.hostname === APP_PROTOCOL_HOST;
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(requestUrl: string): boolean {
  try {
    const url = new URL(requestUrl);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function resolveRendererAsset(rendererRoot: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  if (!isTrustedRendererUrl(requestUrl)) return null;

  let requestedPath: string;
  try {
    requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return null;
  }
  if (requestedPath.includes('\0')) return null;

  const root = path.resolve(rendererRoot);
  const candidate = path.resolve(root, requestedPath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}
