/** Audit actions recorded by the backend. Used for filtering in the UI. */
export const AUDIT_ACTIONS = [
  'workspace.created',
  'workspace.updated',
  'workspace.logo_updated',
  'workspace.deleted',
  'workspace.ownership_transferred',
  'workspace.suspended',
  'workspace.unsuspended',
  'member.invited',
  'member.invite_resent',
  'member.invite_revoked',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'billing.checkout_started',
  'billing.plan_changed',
  'billing.subscription_canceled',
  'billing.payment_failed',
  'project.created',
  'project.deleted',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
