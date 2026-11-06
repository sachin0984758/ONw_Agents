import assert from 'node:assert/strict'
import { localSecurityHeaders } from '../src/lib/agent-hub/security-headers'

let passed = 0
function check(value: unknown, label: string) { assert.ok(value, label); passed++; console.log('PASS', label) }
for (const development of [false, true]) {
  const headers = new Map(localSecurityHeaders(development).map(header => [header.key.toLowerCase(), header.value]))
  const policy = new Map(headers.get('content-security-policy')!.split('; ').map(directive => { const [name, ...values] = directive.split(' '); return [name, values] }))
  check(headers.get('x-frame-options') === 'SAMEORIGIN' && policy.get('frame-ancestors')?.join() === "'self'", 'cross-site framing blocked with matching CSP and legacy protection')
  check(headers.get('x-content-type-options') === 'nosniff', 'content sniffing disabled')
  check(headers.get('referrer-policy') === 'no-referrer', 'referrers suppressed')
  check(policy.get('object-src')?.join() === "'none'", 'embedded plug-ins blocked')
  check(policy.get('form-action')?.join() === "'self'" && policy.get('base-uri')?.join() === "'self'", 'external forms and base URL replacement restricted')
  check(policy.get('script-src')?.includes("'unsafe-eval'") === development, 'eval permitted only for development tooling')
  check(!policy.get('script-src')?.some(value => value === '*' || /^https?:/.test(value)), 'external script origins not whitelisted')
  check(policy.get('script-src')?.includes("'unsafe-inline'") && policy.get('style-src')?.includes("'unsafe-inline'"), 'existing static hydration and sandbox preview inline content retained explicitly')
  check(policy.get('frame-src')?.includes('http://127.0.0.1:*') && policy.get('frame-src')?.includes("'self'"), 'isolated local and srcdoc previews supported')
  check(policy.get('connect-src')?.includes("'self'") && policy.get('connect-src')?.includes('ws://127.0.0.1:*'), 'same-origin API streaming and local development sockets supported')
  check(policy.get('img-src')?.includes('blob:') && policy.get('img-src')?.includes('https:'), 'attachments and GitHub imagery supported')
  check(headers.get('permissions-policy')?.includes('microphone=(self)') && headers.get('permissions-policy')?.includes('geolocation=()'), 'voice capability retained locally and unneeded sensitive capabilities denied')
  check(!headers.has('strict-transport-security') && !policy.has('upgrade-insecure-requests'), 'HTTP localhost is not forcibly upgraded to HTTPS')
  check(!headers.has('cross-origin-embedder-policy'), 'cross-origin preview and image compatibility not blocked by COEP')
}
console.log(`${passed} security header policy checks passed; browser enforcement requires the live verification.`)
