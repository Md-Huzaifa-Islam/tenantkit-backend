export const PLAN_IDS = ['FREE', 'PRO', 'BUSINESS'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceMonthlyCents: number;
  /** `null` means unlimited. */
  maxProjects: number | null;
  /** Members plus pending invites. `null` means unlimited. */
  maxMembers: number | null;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    priceMonthlyCents: 0,
    maxProjects: 3,
    maxMembers: 2,
    features: ['3 projects', '2 members', 'Kanban boards', 'Audit log'],
  },
  PRO: {
    id: 'PRO',
    name: 'Pro',
    priceMonthlyCents: 1900,
    maxProjects: null,
    maxMembers: 10,
    features: ['Unlimited projects', '10 members', 'Everything in Free'],
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: 'Business',
    priceMonthlyCents: 4900,
    maxProjects: null,
    maxMembers: null,
    features: ['Unlimited projects', 'Unlimited members', 'Priority support'],
  },
};

export type LimitKind = 'projects' | 'members';

export function limitFor(plan: PlanId, kind: LimitKind): number | null {
  return kind === 'projects' ? PLANS[plan].maxProjects : PLANS[plan].maxMembers;
}

export function isWithinLimit(plan: PlanId, kind: LimitKind, currentCount: number): boolean {
  const limit = limitFor(plan, kind);
  return limit === null || currentCount < limit;
}
