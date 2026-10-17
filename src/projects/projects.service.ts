import { Injectable } from '@nestjs/common';
import type { Task, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService } from '../billing/plan-limits.service';
import { AppException } from '../common/app-exception';
import type { AuthUser, WorkspaceContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  can,
  type CreateProjectInput,
  type CreateTaskInput,
  type ReorderTasksInput,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from '../shared';

const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00.000Z`) : d === null ? null : undefined);

type TaskWithAssignee = Task & { assignee: { id: string; name: string; avatarUrl: string | null } | null };

function taskDto(t: TaskWithAssignee) {
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    status: t.status,
    position: t.position,
    dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    assignee: t.assignee,
    createdById: t.createdById,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const ASSIGNEE = { select: { id: true, name: true, avatarUrl: true } } as const;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
  ) {}

  private tx<T>(ws: WorkspaceContext, user: AuthUser, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.withTenant({ workspaceId: ws.id, userId: user.id }, fn);
  }

  // ---------- projects ----------

  list(ws: WorkspaceContext, user: AuthUser) {
    return this.tx(ws, user, async (tx) => {
      const projects = await tx.project.findMany({
        where: { workspaceId: ws.id },
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      const counts = await tx.task.groupBy({
        by: ['projectId', 'status'],
        where: { workspaceId: ws.id },
        _count: { _all: true },
      });
      return projects.map((p) => {
        const mine = counts.filter((c) => c.projectId === p.id);
        const by = (s: TaskStatus) => mine.find((c) => c.status === s)?._count._all ?? 0;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          createdAt: p.createdAt,
          createdBy: p.createdBy,
          taskCounts: { TODO: by('TODO'), DOING: by('DOING'), DONE: by('DONE') },
        };
      });
    });
  }

  create(ws: WorkspaceContext, user: AuthUser, input: CreateProjectInput, ip: string | null) {
    return this.tx(ws, user, async (tx) => {
      await this.limits.assertCanAdd(tx, ws, 'projects');
      const project = await tx.project.create({
        data: { workspaceId: ws.id, name: input.name, description: input.description ?? '', createdById: user.id },
      });
      await this.audit.record(tx, {
        workspaceId: ws.id,
        actorId: user.id,
        action: 'project.created',
        targetType: 'project',
        targetId: project.id,
        metadata: { name: project.name },
        ip,
      });
      return project;
    });
  }

  get(ws: WorkspaceContext, user: AuthUser, id: string) {
    return this.tx(ws, user, (tx) => this.findProject(tx, ws.id, id));
  }

  update(ws: WorkspaceContext, user: AuthUser, id: string, input: UpdateProjectInput) {
    return this.tx(ws, user, async (tx) => {
      await this.findProject(tx, ws.id, id);
      return tx.project.update({ where: { id }, data: input });
    });
  }

  remove(ws: WorkspaceContext, user: AuthUser, id: string, ip: string | null) {
    return this.tx(ws, user, async (tx) => {
      const project = await this.findProject(tx, ws.id, id);
      await tx.project.delete({ where: { id } });
      await this.audit.record(tx, {
        workspaceId: ws.id,
        actorId: user.id,
        action: 'project.deleted',
        targetType: 'project',
        targetId: id,
        metadata: { name: project.name },
        ip,
      });
    });
  }

  // ---------- tasks ----------

  listTasks(ws: WorkspaceContext, user: AuthUser, projectId: string) {
    return this.tx(ws, user, async (tx) => {
      await this.findProject(tx, ws.id, projectId);
      const tasks = await tx.task.findMany({
        where: { projectId },
        include: { assignee: ASSIGNEE },
        orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
      });
      return tasks.map(taskDto);
    });
  }

  createTask(ws: WorkspaceContext, user: AuthUser, projectId: string, input: CreateTaskInput) {
    return this.tx(ws, user, async (tx) => {
      await this.findProject(tx, ws.id, projectId);
      if (input.assigneeId) await this.assertMember(tx, ws.id, input.assigneeId);
      const status = input.status ?? 'TODO';
      const task = await tx.task.create({
        data: {
          workspaceId: ws.id,
          projectId,
          title: input.title,
          status,
          assigneeId: input.assigneeId ?? null,
          dueDate: toDate(input.dueDate) ?? null,
          createdById: user.id,
          position: await this.nextPosition(tx, projectId, status),
        },
        include: { assignee: ASSIGNEE },
      });
      return taskDto(task);
    });
  }

  updateTask(ws: WorkspaceContext, user: AuthUser, taskId: string, input: UpdateTaskInput) {
    return this.tx(ws, user, async (tx) => {
      const task = await this.findTask(tx, ws.id, taskId);
      this.assertCanEdit(ws, user, task);
      if (input.assigneeId) await this.assertMember(tx, ws.id, input.assigneeId);
      const statusChanged = input.status && input.status !== task.status;
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          title: input.title,
          status: input.status,
          assigneeId: input.assigneeId,
          dueDate: toDate(input.dueDate),
          ...(statusChanged ? { position: await this.nextPosition(tx, task.projectId, input.status!) } : {}),
        },
        include: { assignee: ASSIGNEE },
      });
      return taskDto(updated);
    });
  }

  removeTask(ws: WorkspaceContext, user: AuthUser, taskId: string) {
    return this.tx(ws, user, async (tx) => {
      const task = await this.findTask(tx, ws.id, taskId);
      this.assertCanEdit(ws, user, task);
      await tx.task.delete({ where: { id: taskId } });
    });
  }

  /**
   * Persists a Kanban drag: the client sends the full ordered contents of the affected
   * columns and positions are rewritten 0..n. Moving a task to another column changes
   * its status, so that requires edit rights on the task; reordering within a column
   * does not.
   */
  reorder(ws: WorkspaceContext, user: AuthUser, input: ReorderTasksInput) {
    return this.tx(ws, user, async (tx) => {
      await this.findProject(tx, ws.id, input.projectId);
      const ids = input.columns.flatMap((c) => c.taskIds);
      if (new Set(ids).size !== ids.length) throw AppException.badRequest('A task appears more than once');
      const statuses = input.columns.map((c) => c.status);
      if (new Set(statuses).size !== statuses.length) throw AppException.badRequest('A column appears more than once');

      const tasks = await tx.task.findMany({ where: { id: { in: ids }, projectId: input.projectId } });
      if (tasks.length !== ids.length) throw AppException.notFound('Task');
      const byId = new Map(tasks.map((t) => [t.id, t]));

      for (const column of input.columns) {
        for (const [position, id] of column.taskIds.entries()) {
          const task = byId.get(id)!;
          if (task.status !== column.status) this.assertCanEdit(ws, user, task);
          if (task.status !== column.status || task.position !== position) {
            await tx.task.update({ where: { id }, data: { status: column.status, position } });
          }
        }
      }
      return { ok: true };
    });
  }

  // ---------- helpers ----------

  private async findProject(tx: Tx, workspaceId: string, id: string) {
    const project = await tx.project.findFirst({ where: { id, workspaceId } });
    if (!project) throw AppException.notFound('Project');
    return project;
  }

  private async findTask(tx: Tx, workspaceId: string, id: string) {
    const task = await tx.task.findFirst({ where: { id, workspaceId } });
    if (!task) throw AppException.notFound('Task');
    return task;
  }

  private async assertMember(tx: Tx, workspaceId: string, userId: string) {
    const m = await tx.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } });
    if (!m) throw AppException.badRequest('Assignee must be a member of this workspace');
  }

  /** Owners/admins manage any task; members only tasks they created or are assigned to. */
  private assertCanEdit(ws: WorkspaceContext, user: AuthUser, task: Task) {
    if (can(ws.role, 'task.manageAny')) return;
    if (task.createdById === user.id || task.assigneeId === user.id) return;
    throw AppException.forbidden('Members can only change tasks they created or are assigned to');
  }

  private async nextPosition(tx: Tx, projectId: string, status: TaskStatus) {
    const last = await tx.task.aggregate({ where: { projectId, status }, _max: { position: true } });
    return (last._max.position ?? -1) + 1;
  }
}
