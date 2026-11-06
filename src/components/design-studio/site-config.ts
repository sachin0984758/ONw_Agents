// Stable bridge for the generated design.
//
// The design DATA lives in `site-config.json` — the only file "Apply Design"
// rewrites. This wrapper never changes, so a small design change only touches
// that one JSON file instead of regenerating the whole site.
import raw from './site-config.json'
import type { DesignConfig } from '@/lib/agent-hub/design-engine'

export const siteConfig = raw as unknown as DesignConfig

export default siteConfig
