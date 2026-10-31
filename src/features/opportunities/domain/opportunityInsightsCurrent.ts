import type { Opportunity, OpportunityReview } from '../../../app/cloudTypes';
import { isOpportunityInPast } from './opportunityDisposition';

/** The Results current/past rule, scoped to the active owner's latest disposition. */
export function currentOpportunityRecords(opportunities: readonly Opportunity[], reviews: readonly OpportunityReview[], ownerId: string, now: Date): Opportunity[] {
  const records = new Map<string, Opportunity>();
  for (const opportunity of opportunities) if (!records.has(opportunity.id)) records.set(opportunity.id, opportunity);
  const latestReviews = new Map<string, OpportunityReview>();
  for (const review of reviews) {
    if (review.user_id !== ownerId || !records.has(review.opportunity_id)) continue;
    const previous = latestReviews.get(review.opportunity_id);
    if (!previous || (review.feedback_revision ?? 0) >= (previous.feedback_revision ?? 0)) latestReviews.set(review.opportunity_id, review);
  }
  return [...records.values()].filter(opportunity => !isOpportunityInPast(opportunity, latestReviews.get(opportunity.id), now));
}
