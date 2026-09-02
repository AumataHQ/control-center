const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Normalises a `Host` header — or a single allowlist entry — to the hostname
 * the URL parser sees, so `truenas:3000`, `truenas`, and an IPv6 literal in
 * brackets all compare the same way. The port is deliberately ignored: the
 * port a request arrives on says nothing about who sent it.
 */
export function hostnameOf(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isLoopbackHostname(hostname: string) {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/**
 * Hostnames this instance answers on, beyond loopback. Control Center has no
 * authentication of its own, so every name added here is a name anyone who can
 * resolve and reach it may use to read the whole dashboard. The default is
 * empty, which keeps the historic behaviour: this computer only.
 */
export function configuredHosts(
  raw = process.env.CONTROL_CENTER_ALLOWED_HOSTS,
) {
  return new Set(
    (raw || "")
      .split(",")
      .map(hostnameOf)
      .filter(Boolean),
  );
}

export function isAllowedHost(
  host: string,
  allowed = configuredHosts(),
): boolean {
  const hostname = hostnameOf(host);
  if (!hostname) return false;
  return isLoopbackHostname(hostname) || allowed.has(hostname);
}
