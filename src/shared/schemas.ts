import { z } from 'zod';
import { ASSIGNABLE_ROLES } from './permissions';
import { PLAN_IDS } from './plans';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

/** Top-level web routes; a workspace with one of these slugs would be unreachable. */
export const RESERVED_SLUGS = [
  'admin', 'api', 'app', 'billing', 'dev', 'docs', 'forgot', 'invite', 'login', 'logout',
  'new', 'reset', 'settings', 'signup', 'static', 'uploads', 'verify', 'www',
] as const;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug must be at least 2 characters')
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single dashes')
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), 'This URL is reserved');

// ---------- Auth ----------
export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email,
  password: passwordSchema,
  workspaceName: z.string().trim().min(2, 'Workspace name is required').max(64),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(256),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(10).max(256) });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

// ---------- Workspaces ----------
export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(64),
  slug: slugSchema.optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(64).optional(),
    slug: slugSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.slug !== undefined, 'Nothing to update');
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

export const transferOwnershipSchema = z.object({ userId: z.string().uuid() });
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

// ---------- Members & invites ----------
export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES);

export const updateMemberRoleSchema = z.object({ role: assignableRoleSchema });
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const createInviteSchema = z.object({ email, role: assignableRoleSchema });
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(10).max(300),
  /** Required only when the invited email has no account yet. */
  name: z.string().trim().min(1).max(80).optional(),
  password: passwordSchema.optional(),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

// ---------- Projects & tasks ----------
export const TASK_STATUSES = ['TODO', 'DOING', 'DONE'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(500).optional().default(''),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable()
  .optional();

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  status: taskStatusSchema.optional().default('TODO'),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate,
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: taskStatusSchema.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate,
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const reorderTasksSchema = z.object({
  projectId: z.string().uuid(),
  /** Full ordered column contents after a drag; positions are rewritten 0..n. */
  columns: z
    .array(
      z.object({
        status: taskStatusSchema,
        taskIds: z.array(z.string().uuid()).max(1000),
      }),
    )
    .min(1)
    .max(TASK_STATUSES.length),
});
export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;

// ---------- Billing ----------
export const planIdSchema = z.enum(PLAN_IDS);
export const checkoutSchema = z.object({ plan: z.enum(['PRO', 'BUSINESS']) });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// ---------- Audit ----------
export const auditLogQuerySchema = z.object({
  action: z.string().max(64).optional(),
  actor: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const adminSuspendSchema = z.object({ suspended: z.boolean() });
export type AdminSuspendInput = z.infer<typeof adminSuspendSchema>;
