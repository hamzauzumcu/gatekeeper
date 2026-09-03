# Gatekeeper — Claude Code Rules

## Language

**All code, comments, strings, UI labels, and commit messages must be in English.**
Never write Turkish in source files — not in comments, not in UI copy, not in variable names, not in SQL.

## Icons

**Every icon comes from Hugeicons Pro `@hugeicons-pro/core-stroke-rounded`,
rendered through `<HugeiconsIcon icon={SomeIcon} className="size-4" />`.**
Do not add `lucide-react`, Iconify, or inline SVG icons, and do not use the
bulk/solid Hugeicons variants. Size icons with Tailwind classes (`size-3.5`,
`size-4`) rather than the `size` prop so shadcn's button/tab rules keep
working. The package is vendored — see [vendor/README.md](vendor/README.md).

Navigation and tab triggers always show an icon next to their label.
