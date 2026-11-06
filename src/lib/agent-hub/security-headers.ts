/** Browser protections for the local application, not a replacement for API
 * authorization. Keep sandboxed srcdoc previews and static Next hydration usable.
 * Preview documents additionally enforce their existing, narrower CSPs. */
export function localSecurityHeaders(development: boolean) {
  const policy = [
    "default-src 'self'",
    // Static Next hydration and sandboxed srcdoc previews use inline scripts.
    // A nonce-only policy needs a separate dynamic-rendering/preview migration.
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
    "media-src 'self' blob: data:",
    "frame-src 'self' blob: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
  return [
    { key: 'Content-Security-Policy', value: policy },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), clipboard-read=(self), clipboard-write=(self), geolocation=(), payment=(), usb=(), serial=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    // No HSTS/upgrade-insecure-requests on plain HTTP localhost. No COEP:
    // require-corp would block existing cross-origin images/isolated previews.
  ]
}
