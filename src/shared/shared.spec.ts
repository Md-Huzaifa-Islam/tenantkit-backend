import { PERMISSIONS, can, canManageMember, permissionsFor, type Permission } from './permissions';
import { isWithinLimit, limitFor } from './plans';
import { createTaskSchema, passwordSchema, reorderTasksSchema, signupSchema } from './schemas';

describe('permission matrix', () => {
  it('grants owners every permission', () => {
    expect(permissionsFor('OWNER')).toEqual(Object.keys(PERMISSIONS));
  });

  it.each<[Permission, boolean, boolean]>([
    ['member.invite', true, false],
    ['billing.manage', false, false],
    ['billing.read', true, false],
    ['workspace.transfer', false, false],
    ['workspace.update', true, false],
    ['project.create', true, false],
    ['task.create', true, true],
    ['task.manageAny', true, false],
    ['audit.read', true, false],
  ])('%s → admin=%s member=%s', (permission, admin, member) => {
    expect(can('ADMIN', permission)).toBe(admin);
    expect(can('MEMBER', permission)).toBe(member);
  });

  it('denies when there is no role', () => {
    expect(can(null, 'workspace.read')).toBe(false);
  });

  it('never allows modifying the owner via member management', () => {
    expect(canManageMember('OWNER', 'OWNER')).toBe(false);
    expect(canManageMember('ADMIN', 'OWNER')).toBe(false);
    expect(canManageMember('ADMIN', 'MEMBER')).toBe(true);
    expect(canManageMember('OWNER', 'ADMIN')).toBe(true);
    expect(canManageMember('MEMBER', 'MEMBER')).toBe(false);
  });
});

describe('plans', () => {
  it('enforces free limits', () => {
    expect(isWithinLimit('FREE', 'projects', 2)).toBe(true);
    expect(isWithinLimit('FREE', 'projects', 3)).toBe(false);
    expect(isWithinLimit('FREE', 'members', 2)).toBe(false);
  });

  it('treats null as unlimited', () => {
    expect(limitFor('PRO', 'projects')).toBeNull();
    expect(isWithinLimit('PRO', 'projects', 10_000)).toBe(true);
    expect(isWithinLimit('PRO', 'members', 10)).toBe(false);
    expect(isWithinLimit('BUSINESS', 'members', 10_000)).toBe(true);
  });
});

describe('schemas', () => {
  it('requires letters and numbers in passwords', () => {
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
    expect(passwordSchema.safeParse('Demo1234!').success).toBe(true);
  });

  it('normalizes signup email', () => {
    const parsed = signupSchema.parse({
      name: 'Ada',
      email: '  Ada@Example.COM ',
      password: 'Secret123',
      workspaceName: 'Acme',
    });
    expect(parsed.email).toBe('ada@example.com');
  });

  it('defaults task status to TODO and validates due dates', () => {
    expect(createTaskSchema.parse({ title: 'x' }).status).toBe('TODO');
    expect(createTaskSchema.safeParse({ title: 'x', dueDate: '12/01/2026' }).success).toBe(false);
  });

  it('rejects reorder payloads with unknown statuses', () => {
    const result = reorderTasksSchema.safeParse({
      projectId: '7d8f7f0c-6a3e-4f0f-9a37-3c1a2a2b6c11',
      columns: [{ status: 'BLOCKED', taskIds: [] }],
    });
    expect(result.success).toBe(false);
  });
});
