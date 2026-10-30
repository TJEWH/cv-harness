import type { Opportunity } from '../../../app/cloudTypes';

export type OpportunityRecency = 'new' | 'updated' | null;
const DAY_MS = 24 * 60 * 60 * 1000;

export function hasReviewedOpportunity(opportunity: Pick<Opportunity, 'created_at' | 'updated_at'>, reviewedUpdatedAt?: string | null): boolean {
  const version = opportunity.updated_at || opportunity.created_at;
  return Boolean(version && reviewedUpdatedAt && Date.parse(reviewedUpdatedAt) >= Date.parse(version));
}

/** Use elapsed time, not calendar dates; new records take precedence over updates. */
export function opportunityRecency(
  opportunity: Pick<Opportunity, 'created_at' | 'updated_at'>,
  now: Date,
  reviewedUpdatedAt?: string | null,
): OpportunityRecency {
  if (hasReviewedOpportunity(opportunity, reviewedUpdatedAt)) return null;
  const currentTime = now.getTime();
  const recent = (timestamp: string | null) => {
    if (!timestamp) return false;
    const elapsed = currentTime - Date.parse(timestamp);
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < DAY_MS;
  };
  if (recent(opportunity.created_at) && !(reviewedUpdatedAt && Date.parse(reviewedUpdatedAt) >= Date.parse(opportunity.created_at!))) return 'new';
  return recent(opportunity.updated_at) ? 'updated' : null;
}
