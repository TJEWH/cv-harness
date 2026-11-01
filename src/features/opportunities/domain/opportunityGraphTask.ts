import { layoutOpportunityGraph, type OpportunityGraphLayoutRequest, type OpportunityGraphLayoutResponse } from './opportunityGraphLayout';
import { buildOpportunityJobGraph, projectOpportunityJobGraph } from './opportunityJobGraph';
import { opportunityJobsAtInterest } from './opportunityJobInterest';
import { buildOpportunityTopicHierarchy } from './opportunityTopicHierarchy';
import { buildOpportunityJobHierarchy } from './opportunityJobHierarchy';
import { clusterOpportunityJobs } from './opportunityJobKMeans';
import { prepareOpportunityJobTopics } from './opportunityJobTopicSimilarity';
import { buildOpportunityJobBundling } from './opportunityJobBundling';

/** Worker entry point: complete job evidence is never constructed on the UI thread. */
export function runOpportunityGraphTask(request: OpportunityGraphLayoutRequest): OpportunityGraphLayoutResponse {
  const jobInput = request.jobs ? { jobs: opportunityJobsAtInterest(request.jobs, request.jobMinimumInterest), topics: request.jobTopics } : null;
  const options = { excludedTopicIds: request.jobExcludedTopicIds };
  const prepared = jobInput ? prepareOpportunityJobTopics(jobInput, options) : undefined;
  const complete = jobInput ? { ...request, ...buildOpportunityJobGraph(jobInput, request.jobMinimumInterest, { ...options, prepared }) } : request;
  const partition = jobInput ? clusterOpportunityJobs(jobInput.jobs, prepared!, request.jobClusterCount) : undefined;
  const graph = request.jobs ? projectOpportunityJobGraph(complete) : undefined;
  const hierarchy = request.jobs ? buildOpportunityJobHierarchy(request.jobs, complete.nodes, prepared, complete.links, partition!.groups)
    : request.view === 'hierarchy' ? buildOpportunityTopicHierarchy(complete) : undefined;
  const bundling = request.view === 'bundling' && jobInput
    ? buildOpportunityJobBundling(jobInput.jobs, hierarchy!, { ...options, minimumInterest: 0,
      // Reserve enough circumference for readable, non-overlapping job labels.
      radius: Math.max(240, (jobInput.jobs.length + partition!.groups.length * 1.4) * 5.5) }) : undefined;
  return { generation: request.generation, positions: request.view === 'hierarchy' || request.view === 'bundling' ? []
    : layoutOpportunityGraph({ ...complete, communityAssignments: partition?.assignments }), hierarchy, bundling, graph };
}
