// Granular capability flags, mirrored from the server (worker/permissions.ts).
// is_admin ("Full access") implies every permission plus user management.

export const PERMISSIONS = [
  'view_applications',
  'view_salary',
  'manage_leave',
  'recruiting_admin',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export type PermissionMap = Record<Permission, boolean>

// Labels and help text for the admin editor.
export const PERMISSION_META: Record<Permission, { label: string; description: string }> = {
  view_applications: {
    label: 'View applications',
    description: 'See the candidate list and candidate details.',
  },
  view_salary: {
    label: 'View salary',
    description: 'See salary expectations submitted by candidates.',
  },
  manage_leave: {
    label: 'Manage leave',
    description: 'See the leave module, approve/reject leave, and map employees.',
  },
  recruiting_admin: {
    label: 'Recruiting admin',
    description: 'Import CSVs, edit AI scoring prompts, run syncs, and the danger zone.',
  },
}

export function emptyPermissions(): PermissionMap {
  return {
    view_applications: false,
    view_salary: false,
    manage_leave: false,
    recruiting_admin: false,
  }
}
