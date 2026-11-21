const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

export const isLoopbackUrl = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname.replace(/^\[(.*)\]$/, '$1');
    return LOOPBACK_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
};
