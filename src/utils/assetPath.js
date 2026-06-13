/**
 * Resolve a site-relative asset path so it works both in local dev (base `/`)
 * and in GitHub Pages deployments under a subpath (e.g. `/skybloom/`).
 *
 * Vite injects the correct `import.meta.env.BASE_URL` at build time.
 */
export function resolveAsset(path) {
  if (typeof path !== 'string' || path.length === 0) return path;
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${normalizedBase}${normalizedPath}`;
}
