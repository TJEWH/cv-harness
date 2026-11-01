export const TOPIC_CLUSTER_COLORS = ['#a7c4b5', '#9abdcf', '#baaed0', '#d0bd93', '#8ebfbd', '#c6abc1'] as const;
export const JOB_CLUSTER_COLORS = [...TOPIC_CLUSTER_COLORS, '#d9a17e', '#8f9ed1', '#b8ca87', '#d78e9b'] as const;

export const JOB_BUNDLING_EDGE_COLORS = { min: '#4d9fff', max: '#ef5350' } as const;
const bundlingEdgeChannels = [JOB_BUNDLING_EDGE_COLORS.min, JOB_BUNDLING_EDGE_COLORS.max]
  .map(hex => [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)));

/** One observed topic is blue; the current cohort's maximum is red. */
export function opportunityJobBundlingEdgeColor(sharedTopicCount: number, maximumSharedTopics: number): string {
  const fraction = maximumSharedTopics > 1 ? Math.max(0, Math.min(1, (sharedTopicCount - 1) / (maximumSharedTopics - 1))) : 0;
  return `#${bundlingEdgeChannels[0]!.map((channel, index) => Math.round(channel + (bundlingEdgeChannels[1]![index]! - channel) * fraction)
    .toString(16).padStart(2, '0')).join('')}`;
}
