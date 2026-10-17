/**
 * Single source of truth for workspace-level authorization.
 *
 * The backend enforces this matrix with `@RequirePermission()`; the frontend
 * reads the same matrix to hide actions the current user cannot perform.
 */
export const ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  'workspace.read': ['OWNER', 'ADMIN', 'MEMBER'],
  'workspace.update': ['OWNER', 'ADMIN'],
  'workspace.delete': ['OWNER'],
  'workspace.transfer': ['OWNER'],

  'member.read': ['OWNER', 'ADMIN', 'MEMBER'],
  'member.invite': ['OWNER', 'ADMIN'],
  'member.updateRole': ['OWNER', 'ADMIN'],
  'member.remove': ['OWNER', 'ADMIN'],

  'billing.read': ['OWNER', 'ADMIN'],
  'billing.manage': ['OWNER'],

  'project.read': ['OWNER', 'ADMIN', 'MEMBER'],
  'project.create': ['OWNER', 'ADMIN'],
  'project.update': ['OWNER', 'ADMIN'],
  'project.delete': ['OWNER', 'ADMIN'],

  'task.read': ['OWNER', 'ADMIN', 'MEMBER'],
  'task.create': ['OWNER', 'ADMIN', 'MEMBER'],
  /** Edit or delete tasks created by or assigned to someone else. */
  'task.manageAny': ['OWNER', 'ADMIN'],

  'audit.read': ['OWNER', 'ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}

const ROLE_RANK: Record<Role, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

/**
 * Whether `actor` may change the membership of `target` (role change or removal).
 * Nobody can modify the owner (ownership moves only via transfer), and admins
 * cannot modify other admins' standing above their own rank.
 */
export function canManageMember(actor: Role, target: Role): boolean {
  if (!can(actor, 'member.updateRole')) return false;
  if (target === 'OWNER') return false;
  return ROLE_RANK[actor] >= ROLE_RANK[target];
}

/** Roles that can be granted through invites or role changes (never OWNER). */
export const ASSIGNABLE_ROLES = ['ADMIN', 'MEMBER'] as const satisfies readonly Role[];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
