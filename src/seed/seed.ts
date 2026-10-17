import { PrismaClient, Role, TaskStatus } from '@prisma/client';
import { hashPassword } from '../auth/password';

/**
 * Demo data (spec §9). Runs as the schema owner because it writes across tenants.
 * It resets all application tables first, so it is safe to run repeatedly.
 */
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Small deterministic PRNG so every seed produces the same demo.
let state = 42;
function rand(): number {
  state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
  return state / 2 ** 31;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const daysAgo = (n: number, hour = 10) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, Math.floor(rand() * 60), 0, 0);
  return d;
};
const dateOnly = (offsetDays: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
};

const ACME_PEOPLE = [
  { name: 'Sara Ahmed', email: 'sara@acme.test', role: Role.ADMIN },
  { name: 'Leo Martin', email: 'leo@acme.test', role: Role.MEMBER },
  { name: 'Priya Nair', email: 'priya@acme.test', role: Role.MEMBER },
  { name: 'Tom Becker', email: 'tom@acme.test', role: Role.MEMBER },
  { name: 'Mina Park', email: 'mina@acme.test', role: Role.ADMIN },
];

const ACME_PROJECTS = [
  {
    name: 'Website Redesign',
    description: 'New marketing site with refreshed brand and faster pages.',
    tasks: [
      'Audit current site analytics',
      'Draft sitemap',
      'Wireframe homepage',
      'Design system tokens',
      'Hero illustration',
      'Pricing page copy',
      'Implement responsive nav',
      'Lighthouse pass',
      'SEO metadata',
      'Launch checklist',
      'Redirect map for old URLs',
    ],
  },
  {
    name: 'Mobile App v2',
    description: 'Offline mode, push notifications and a faster onboarding flow.',
    tasks: [
      'Offline sync spike',
      'Push notification service',
      'Onboarding screens',
      'Crash reporting',
      'App Store screenshots',
      'Beta tester list',
      'Dark mode audit',
      'Accessibility labels',
      'Release notes',
      'Performance profiling',
    ],
  },
  {
    name: 'Q4 Marketing Campaign',
    description: 'Webinar series, case studies and a product launch email sequence.',
    tasks: [
      'Pick webinar topics',
      'Book guest speakers',
      'Case study: Globex',
      'Landing page',
      'Email sequence (5 emails)',
      'Paid social budget',
      'UTM conventions',
      'Post-campaign report',
      'Partner co-marketing outreach',
    ],
  },
  {
    name: 'Customer Onboarding',
    description: 'Reduce time-to-value for new accounts from 7 days to 2.',
    tasks: [
      'Map current onboarding journey',
      'Interview 5 new customers',
      'In-app checklist',
      'Welcome email series',
      'Sample data importer',
      'Kickoff call template',
      'Success metrics dashboard',
      'Help center articles',
      'Churn-risk alerts',
      'Quarterly review deck',
    ],
  },
];

const AUDIT_SAMPLES: Array<{ action: string; targetType: string; meta?: object }> = [
  { action: 'member.invited', targetType: 'invite' },
  { action: 'member.joined', targetType: 'membership' },
  { action: 'member.role_changed', targetType: 'membership', meta: { from: 'MEMBER', to: 'ADMIN' } },
  { action: 'workspace.updated', targetType: 'workspace', meta: { name: 'Acme Inc' } },
  { action: 'project.created', targetType: 'project' },
  { action: 'billing.plan_changed', targetType: 'workspace', meta: { from: 'FREE', to: 'PRO' } },
  { action: 'member.invite_resent', targetType: 'invite' },
];

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, tasks, projects, invites, memberships, refresh_tokens,
       password_reset_tokens, email_verification_tokens, workspaces, users, stripe_events, dev_emails
     RESTART IDENTITY CASCADE`,
  );
}

async function main() {
  console.log('Seeding TenantKit demo data...');
  await reset();

  const demoHash = await hashPassword('Demo1234!');
  const adminHash = await hashPassword('Admin1234!');
  const memberHash = await hashPassword('Member1234!');
  const verified = daysAgo(60);

  const demo = await prisma.user.create({
    data: {
      email: 'demo@tenantkit.dev',
      name: 'Demo Owner',
      passwordHash: demoHash,
      emailVerifiedAt: verified,
      createdAt: daysAgo(60),
      lastActiveAt: new Date(),
    },
  });
  await prisma.user.create({
    data: {
      email: 'admin@tenantkit.dev',
      name: 'Platform Admin',
      passwordHash: adminHash,
      emailVerifiedAt: verified,
      isSuperAdmin: true,
      createdAt: daysAgo(90),
      lastActiveAt: new Date(),
    },
  });

  // ---------- Acme Inc (Pro) ----------
  const periodEnd = dateOnly(23);
  const acme = await prisma.workspace.create({
    data: {
      name: 'Acme Inc',
      slug: 'acme',
      plan: 'PRO',
      stripeCustomerId: 'cus_mock_acme',
      stripeSubscriptionId: 'sub_mock_acme',
      currentPeriodEnd: periodEnd,
      createdAt: daysAgo(58),
    },
  });
  await prisma.membership.create({
    data: { userId: demo.id, workspaceId: acme.id, role: Role.OWNER, createdAt: daysAgo(58) },
  });

  const acmeUsers = [demo];
  for (const [i, person] of ACME_PEOPLE.entries()) {
    const user = await prisma.user.create({
      data: {
        email: person.email,
        name: person.name,
        passwordHash: memberHash,
        emailVerifiedAt: verified,
        createdAt: daysAgo(50 - i * 5),
        lastActiveAt: i < 3 ? daysAgo(i + 1) : daysAgo(20),
      },
    });
    await prisma.membership.create({
      data: { userId: user.id, workspaceId: acme.id, role: person.role, createdAt: daysAgo(50 - i * 5) },
    });
    acmeUsers.push(user);
  }

  const statuses: TaskStatus[] = [TaskStatus.TODO, TaskStatus.DOING, TaskStatus.DONE];
  let taskCount = 0;
  for (const [pi, project] of ACME_PROJECTS.entries()) {
    const created = await prisma.project.create({
      data: {
        workspaceId: acme.id,
        name: project.name,
        description: project.description,
        createdById: pick([acmeUsers[0], acmeUsers[1], acmeUsers[5]]).id,
        createdAt: daysAgo(45 - pi * 7),
      },
    });
    const positions: Record<TaskStatus, number> = { TODO: 0, DOING: 0, DONE: 0 };
    for (const title of project.tasks) {
      const status = pick(statuses);
      const assignee = rand() < 0.85 ? pick(acmeUsers) : null;
      await prisma.task.create({
        data: {
          workspaceId: acme.id,
          projectId: created.id,
          title,
          status,
          assigneeId: assignee?.id ?? null,
          createdById: pick(acmeUsers).id,
          dueDate: rand() < 0.7 ? dateOnly(Math.floor(rand() * 30) - 7) : null,
          position: positions[status]++,
          createdAt: daysAgo(40 - Math.floor(rand() * 30)),
        },
      });
      taskCount++;
    }
  }

  const auditRows = Array.from({ length: 30 }, (_, i) => {
    const sample = pick(AUDIT_SAMPLES);
    return {
      workspaceId: acme.id,
      actorId: pick([acmeUsers[0], acmeUsers[1], acmeUsers[5]]).id,
      action: sample.action,
      targetType: sample.targetType,
      targetId: pick(acmeUsers).id,
      metadata: sample.meta ?? {},
      ip: `203.0.113.${10 + Math.floor(rand() * 40)}`,
      createdAt: daysAgo(30 - i, 9 + (i % 8)),
    };
  });
  await prisma.auditLog.createMany({ data: auditRows });

  // ---------- Globex (Free, at its limits) ----------
  const globexOwner = await prisma.user.create({
    data: {
      email: 'hank@globex.test',
      name: 'Hank Scorpio',
      passwordHash: memberHash,
      emailVerifiedAt: verified,
      createdAt: daysAgo(30),
    },
  });
  const globex = await prisma.workspace.create({
    data: { name: 'Globex', slug: 'globex', plan: 'FREE', createdAt: daysAgo(30) },
  });
  await prisma.membership.createMany({
    data: [
      { userId: globexOwner.id, workspaceId: globex.id, role: Role.OWNER, createdAt: daysAgo(30) },
      { userId: demo.id, workspaceId: globex.id, role: Role.MEMBER, createdAt: daysAgo(25) },
    ],
  });
  for (const [i, name] of ['Doomsday Device', 'Volcano Lair', 'Hammock District'].entries()) {
    const p = await prisma.project.create({
      data: {
        workspaceId: globex.id,
        name,
        description: 'Globex initiative',
        createdById: globexOwner.id,
        createdAt: daysAgo(28 - i * 3),
      },
    });
    await prisma.task.createMany({
      data: ['Kickoff', 'Requirements', 'Prototype'].map((title, position) => ({
        workspaceId: globex.id,
        projectId: p.id,
        title,
        status: TaskStatus.TODO,
        createdById: globexOwner.id,
        position,
      })),
    });
  }
  await prisma.auditLog.createMany({
    data: [
      { workspaceId: globex.id, actorId: globexOwner.id, action: 'workspace.created', targetType: 'workspace', targetId: globex.id, createdAt: daysAgo(30) },
      { workspaceId: globex.id, actorId: demo.id, action: 'member.joined', targetType: 'membership', targetId: demo.id, createdAt: daysAgo(25) },
    ],
  });

  // ---------- A few more workspaces so the admin panel looks alive ----------
  const extra = [
    { name: 'Initech', slug: 'initech', plan: 'BUSINESS' as const, days: 75 },
    { name: 'Umbrella Labs', slug: 'umbrella', plan: 'PRO' as const, days: 40 },
    { name: 'Stark Studio', slug: 'stark', plan: 'FREE' as const, days: 12 },
    { name: 'Wayne Analytics', slug: 'wayne', plan: 'PRO' as const, days: 5, suspended: true },
  ];
  for (const w of extra) {
    const owner = await prisma.user.create({
      data: {
        email: `owner@${w.slug}.test`,
        name: `${w.name} Owner`,
        passwordHash: memberHash,
        emailVerifiedAt: verified,
        createdAt: daysAgo(w.days),
        lastActiveAt: daysAgo(Math.min(w.days, 3)),
      },
    });
    const ws = await prisma.workspace.create({
      data: {
        name: w.name,
        slug: w.slug,
        plan: w.plan,
        status: w.suspended ? 'SUSPENDED' : 'ACTIVE',
        createdAt: daysAgo(w.days),
        ...(w.plan !== 'FREE'
          ? { stripeCustomerId: `cus_mock_${w.slug}`, stripeSubscriptionId: `sub_mock_${w.slug}`, currentPeriodEnd: dateOnly(15) }
          : {}),
      },
    });
    await prisma.membership.create({ data: { userId: owner.id, workspaceId: ws.id, role: Role.OWNER } });
  }

  console.log(`  users:        ${await prisma.user.count()}`);
  console.log(`  workspaces:   ${await prisma.workspace.count()}`);
  console.log(`  acme tasks:   ${taskCount}`);
  console.log(`  audit rows:   ${await prisma.auditLog.count()}`);
  console.log('\nDemo logins:');
  console.log('  demo@tenantkit.dev  / Demo1234!   (owner of Acme Inc [Pro], member of Globex [Free])');
  console.log('  admin@tenantkit.dev / Admin1234!  (super admin, /admin)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
