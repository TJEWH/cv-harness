import type { OpportunityInsightGraph } from './opportunityInsights';

export function opportunityJobInterestMinimum(value = 8): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(10, value)) : 8;
}

export function opportunityJobsAtInterest(jobs: OpportunityInsightGraph['jobs'], minimumInterest = 8) {
  const minimum = opportunityJobInterestMinimum(minimumInterest);
  return jobs.filter(job => job.explicitInterest && job.interestScore !== null && job.interestScore >= minimum)
    .sort((a, b) => a.id.localeCompare(b.id));
}


/** Requested view granularity, bounded by the available jobs without hiding any. */
export function opportunityJobClusterCount(value = 5, availableJobs?: number): number {
  const requested = Number.isFinite(value) ? Math.round(value) : 5;
  const maximum = availableJobs === undefined || !Number.isFinite(availableJobs) ? 10 : Math.max(1, Math.min(10, Math.floor(availableJobs)));
  return Math.max(1, Math.min(maximum, requested));
}
