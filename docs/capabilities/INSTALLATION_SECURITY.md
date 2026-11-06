# Capability installation and security

- The pack catalog and state are local JSON under the selected `DB_DIR`.
- Built-in packs are metadata references. Installing a built-in does not fetch
  code or change a workspace.
- Imported packs are declarative JSON only. The validator drops unknown fields;
  it accepts only names from the existing Session tool list and agent roster.
- Import does not execute scripts, run a package manager, open a connection,
  write project files, or grant permissions.
- Remote registry provenance must be HTTPS; no remote pack fetch/update action
  exists in this implementation.
- Enabling/assignment changes prompt routing only. Session workspace and
  per-mutation approval checks stay in their existing services.
- Uninstall refuses removal when an installed pack has a required dependency on
  it. It does not delete Skills, components, templates, or project files.
- A pack description or imported metadata is untrusted data. It cannot override
  AgentHub policy or authorize a requested tool action.

The UI component marketplace remains a separate reviewed source-installation
workflow because it actually writes reviewed React files into an explicitly
selected project. The Skills Library remains the only skill installation
workflow. No second Skills or UI component registry has been added.

