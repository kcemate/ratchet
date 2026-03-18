export type Plan = 'free' | 'builder' | 'pro' | 'team' | 'enterprise';
export type UsageType = 'scan' | 'torque' | 'vision';

export interface TierLimits {
  cyclesPerPeriod: number;
  periodDays: number;
  allowedTypes: UsageType[];
}

export const TIER_LIMITS: Record<Plan, TierLimits> = {
  free:       { cyclesPerPeriod: 3,        periodDays: 7,  allowedTypes: ['scan', 'vision'] },
  builder:    { cyclesPerPeriod: 30,       periodDays: 30, allowedTypes: ['scan', 'torque', 'vision'] },
  pro:        { cyclesPerPeriod: 150,      periodDays: 30, allowedTypes: ['scan', 'torque', 'vision'] },
  team:       { cyclesPerPeriod: 500,      periodDays: 30, allowedTypes: ['scan', 'torque', 'vision'] },
  enterprise: { cyclesPerPeriod: Infinity, periodDays: 30, allowedTypes: ['scan', 'torque', 'vision'] },
};

export function getPeriodStart(plan: Plan, now = new Date()): Date {
  const { periodDays } = TIER_LIMITS[plan];
  const start = new Date(now);
  start.setDate(start.getDate() - periodDays);
  return start;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  cyclesUsed?: number;
  cyclesRemaining?: number;
}

export function checkTierLimit(
  plan: Plan,
  usageType: UsageType,
  cyclesUsedThisPeriod: number,
): LimitCheckResult {
  const limits = TIER_LIMITS[plan];

  if (!limits.allowedTypes.includes(usageType)) {
    return {
      allowed: false,
      reason: `${usageType} is not available on the ${plan} plan`,
    };
  }

  if (limits.cyclesPerPeriod === Infinity) {
    return { allowed: true, cyclesUsed: cyclesUsedThisPeriod, cyclesRemaining: Infinity };
  }

  const remaining = limits.cyclesPerPeriod - cyclesUsedThisPeriod;
  if (remaining <= 0) {
    return {
      allowed: false,
      reason: 'cycle_limit_reached',
      cyclesUsed: cyclesUsedThisPeriod,
      cyclesRemaining: 0,
    };
  }

  return {
    allowed: true,
    cyclesUsed: cyclesUsedThisPeriod,
    cyclesRemaining: remaining,
  };
}
