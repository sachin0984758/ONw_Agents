export const COMPONENT_CATEGORIES = ['Buttons and controls', 'Forms and inputs', 'Navigation and sidebars', 'Cards and layouts', 'Dashboards', 'Charts and data visualization', 'AI chat interfaces', 'Code editors and developer tools', 'Animations and transitions', 'Dialogs, popovers and overlays', 'Loading indicators', 'Tables and data grids', 'File management UI', 'Agent interfaces', 'Settings panels', 'Complete application blocks'] as const
export interface ComponentFile { path: string; target: string; content: string; type: string }
export interface MarketplaceComponent {
  id: string; name: string; description: string; category: string; source: string; author: string; revision: string; framework: 'React';
  dependencies: string[]; devDependencies: string[]; registryDependencies: string[]; registryUrl?: string; license?: string; tags: string[];
  files: ComponentFile[]; preview: { kind: 'builtin' | 'unavailable'; key?: string; reason?: string }; updatedAt: string;
}
export interface StylingPreset { id: string; name: string; theme: 'light' | 'dark'; background: string; foreground: string; accent: string; typography: 'sans' | 'mono' | 'serif'; spacing: 'compact' | 'comfortable'; radius: number; shadow: number; motion: boolean }
export interface TrustedRegistry { id: string; name: string; url: string; createdAt: string }
export interface ProposedFile { path: string; before: string | null; after: string | null; conflict: boolean }
export interface InstallProposal { id: string; componentId: string; componentName: string; revision: string; workspaceId: string; workspaceRoot: string; operation: 'install' | 'uninstall' | 'restore'; installationId?: string; files: ProposedFile[]; dependencies: string[]; warnings: string[]; expiresAt: string }
export interface Installation { id: string; componentId: string; componentName: string; revision: string; workspaceId: string; workspaceRoot: string; operation: InstallProposal['operation']; files: ProposedFile[]; createdAt: string; status: 'installed' | 'uninstalled' | 'restored'; verification: string[] }
export interface MarketplaceState { version: 1; components: MarketplaceComponent[]; favorites: string[]; recent: string[]; presets: StylingPreset[]; registries: TrustedRegistry[]; installations: Installation[] }
