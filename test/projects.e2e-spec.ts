import type { App } from 'supertest/types';
import { ownerDb, resetDb } from './db';
import { addMember, as, createOwner, setPlan, type Actor } from './fixtures';
import { closeApp, getApp } from './helpers';

describe('projects & tasks', () => {
  let server: App;

  beforeAll(async () => {
    await resetDb();
    server = (await getApp()).getHttpServer();
  });
  afterAll(closeApp);

  async function proWorkspace(name: string) {
    const owner = await createOwner(server, name);
    await setPlan(owner.workspaceId, 'PRO');
    const project = await as(server, owner).post('/projects', { name: 'Board' }).expect(201);
    return { owner, projectId: project.body.id as string };
  }

  describe('projects', () => {
    it('creates, lists with task counts, updates and deletes a project', async () => {
      const owner = await createOwner(server, 'Proj CRUD');
      const created = await as(server, owner).post('/projects', { name: 'Launch', description: 'Go live' }).expect(201);
      await as(server, owner).post(`/projects/${created.body.id}/tasks`, { title: 'A' }).expect(201);
      await as(server, owner).post(`/projects/${created.body.id}/tasks`, { title: 'B', status: 'DONE' }).expect(201);

      const list = await as(server, owner).get('/projects').expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ name: 'Launch', taskCounts: { TODO: 1, DOING: 0, DONE: 1 } });

      await as(server, owner).patch(`/projects/${created.body.id}`, { name: 'Launch v2' }).expect(200);
      await as(server, owner).delete(`/projects/${created.body.id}`).expect(204);
      expect(await ownerDb.task.count({ where: { projectId: created.body.id } })).toBe(0);
      const actions = (await ownerDb.auditLog.findMany({ where: { workspaceId: owner.workspaceId } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['project.created', 'project.deleted']));
    });

    it('enforces the Free plan limit of 3 projects server-side', async () => {
      const owner = await createOwner(server, 'Free Limit');
      for (let i = 0; i < 3; i++) await as(server, owner).post('/projects', { name: `P${i}` }).expect(201);
      const res = await as(server, owner).post('/projects', { name: 'P4' }).expect(402);
      expect(res.body.error).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { kind: 'projects', limit: 3, current: 3 } });
    });

    it('cannot be raced past the limit with parallel requests', async () => {
      const owner = await createOwner(server, 'Race Limit');
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => as(server, owner).post('/projects', { name: `R${i}` })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 402)).toHaveLength(3);
      expect(await ownerDb.project.count({ where: { workspaceId: owner.workspaceId } })).toBe(3);
    });

    it('has no project limit on Pro', async () => {
      const { owner } = await proWorkspace('Pro Unlimited');
      for (let i = 0; i < 4; i++) await as(server, owner).post('/projects', { name: `P${i}` }).expect(201);
    });

    it('members can view projects but not create or delete them', async () => {
      const { owner, projectId } = await proWorkspace('Member View');
      const member = await addMember(server, owner.workspaceId, 'MEMBER');
      await as(server, member).get('/projects').expect(200);
      await as(server, member).get(`/projects/${projectId}`).expect(200);
      await as(server, member).post('/projects', { name: 'x' }).expect(403);
      await as(server, member).delete(`/projects/${projectId}`).expect(403);
    });
  });

  describe('tasks', () => {
    let owner: Actor;
    let projectId: string;
    let member: Actor;
    let other: Actor;

    beforeAll(async () => {
      ({ owner, projectId } = await proWorkspace('Tasks Co'));
      member = await addMember(server, owner.workspaceId, 'MEMBER');
      other = await addMember(server, owner.workspaceId, 'MEMBER');
    });

    it('appends new tasks to the end of their column', async () => {
      const a = await as(server, owner).post(`/projects/${projectId}/tasks`, { title: 'first' }).expect(201);
      const b = await as(server, owner).post(`/projects/${projectId}/tasks`, { title: 'second' }).expect(201);
      expect(b.body.position).toBe(a.body.position + 1);
      expect(a.body).toMatchObject({ status: 'TODO', assignee: null, dueDate: null });
    });

    it('stores due dates as calendar dates and validates the assignee', async () => {
      const t = await as(server, owner)
        .post(`/projects/${projectId}/tasks`, { title: 'dated', dueDate: '2026-12-01', assigneeId: member.userId })
        .expect(201);
      expect(t.body.dueDate).toBe('2026-12-01');
      expect(t.body.assignee.id).toBe(member.userId);
      const outsider = await createOwner(server, 'Outsider Co');
      await as(server, owner).post(`/projects/${projectId}/tasks`, { title: 'x', assigneeId: outsider.userId }).expect(400);
    });

    it('members can create tasks and edit their own', async () => {
      const t = await as(server, member).post(`/projects/${projectId}/tasks`, { title: 'mine' }).expect(201);
      await as(server, member).patch(`/tasks/${t.body.id}`, { status: 'DOING' }).expect(200);
      await as(server, member).delete(`/tasks/${t.body.id}`).expect(204);
    });

    it('members can edit tasks assigned to them', async () => {
      const t = await as(server, owner).post(`/projects/${projectId}/tasks`, { title: 'assigned', assigneeId: member.userId }).expect(201);
      await as(server, member).patch(`/tasks/${t.body.id}`, { status: 'DONE' }).expect(200);
    });

    it('members cannot edit or delete someone else’s task; admins can', async () => {
      const t = await as(server, other).post(`/projects/${projectId}/tasks`, { title: 'not yours' }).expect(201);
      const res = await as(server, member).patch(`/tasks/${t.body.id}`, { title: 'hijacked' }).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await as(server, member).delete(`/tasks/${t.body.id}`).expect(403);
      await as(server, owner).patch(`/tasks/${t.body.id}`, { title: 'fixed by owner' }).expect(200);
    });

    it('moves a task to the end of the new column when its status changes', async () => {
      const done1 = await as(server, owner).post(`/projects/${projectId}/tasks`, { title: 'd1', status: 'DONE' }).expect(201);
      const moved = await as(server, owner).post(`/projects/${projectId}/tasks`, { title: 'mover' }).expect(201);
      const res = await as(server, owner).patch(`/tasks/${moved.body.id}`, { status: 'DONE' }).expect(200);
      expect(res.body.position).toBeGreaterThan(done1.body.position);
    });
  });

  describe('reorder (Kanban drag and drop)', () => {
    it('rewrites positions and statuses from the submitted columns', async () => {
      const { owner, projectId } = await proWorkspace('Reorder Co');
      const ids: string[] = [];
      for (const title of ['a', 'b', 'c']) {
        ids.push((await as(server, owner).post(`/projects/${projectId}/tasks`, { title }).expect(201)).body.id);
      }
      await as(server, owner)
        .post('/tasks/reorder', {
          projectId,
          columns: [
            { status: 'TODO', taskIds: [ids[2], ids[0]] },
            { status: 'DOING', taskIds: [ids[1]] },
          ],
        })
        .expect(200);
      const tasks = await as(server, owner).get(`/projects/${projectId}/tasks`).expect(200);
      expect(tasks.body.map((t: { title: string; status: string; position: number }) => [t.title, t.status, t.position])).toEqual([
        ['c', 'TODO', 0],
        ['a', 'TODO', 1],
        ['b', 'DOING', 0],
      ]);
    });

    it('rejects duplicate ids and tasks from another project', async () => {
      const { owner, projectId } = await proWorkspace('Reorder Bad');
      const t = (await as(server, owner).post(`/projects/${projectId}/tasks`, { title: 'a' }).expect(201)).body.id;
      const other = (await as(server, owner).post('/projects', { name: 'Other' }).expect(201)).body.id;
      const foreign = (await as(server, owner).post(`/projects/${other}/tasks`, { title: 'z' }).expect(201)).body.id;
      await as(server, owner).post('/tasks/reorder', { projectId, columns: [{ status: 'TODO', taskIds: [t, t] }] }).expect(400);
      await as(server, owner).post('/tasks/reorder', { projectId, columns: [{ status: 'TODO', taskIds: [t, foreign] }] }).expect(404);
    });

    it('lets members reorder within a column but not move others’ tasks across columns', async () => {
      const { owner, projectId } = await proWorkspace('Reorder Member');
      const member = await addMember(server, owner.workspaceId, 'MEMBER');
      const a = (await as(server, owner).post(`/projects/${projectId}/tasks`, { title: 'a' }).expect(201)).body.id;
      const b = (await as(server, owner).post(`/projects/${projectId}/tasks`, { title: 'b' }).expect(201)).body.id;
      await as(server, member).post('/tasks/reorder', { projectId, columns: [{ status: 'TODO', taskIds: [b, a] }] }).expect(200);
      await as(server, member)
        .post('/tasks/reorder', { projectId, columns: [{ status: 'TODO', taskIds: [b] }, { status: 'DONE', taskIds: [a] }] })
        .expect(403);
      expect((await ownerDb.task.findUniqueOrThrow({ where: { id: a } })).status).toBe('TODO');
    });
  });
});
