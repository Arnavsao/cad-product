/**
 * Every scheduled housekeeping job, declared in code.
 *
 * Same rule as the feature-flag registry: the code decides which jobs exist, so
 * a typo in a URL cannot invent one and a job nothing implements cannot be
 * triggered. The scheduler (a Container Apps cron hitting the run endpoint)
 * names a key from this list and nothing else.
 */
export interface JobDefinition {
  /** What it does, in staff-facing words. */
  description: string;
  /**
   * Suggested cron, for the docs and the UI. Nothing reads it at runtime — the
   * schedule lives in the Container Apps job, because that is what actually
   * fires, and two sources of truth for a schedule is one too many.
   */
  suggestedCron: string;
  /**
   * How long a run may take before it is presumed dead. A run still marked
   * RUNNING past this is what "stuck" means; nothing kills it, because killing
   * a job mid-write is worse than leaving it to finish.
   */
  timeoutMinutes: number;
  /** True when the job deletes data. Surfaced in the UI, and never auto-run first. */
  destructive: boolean;
}

export const JOB_REGISTRY = {
  'trash.purge': {
    description: 'Permanently delete drawings that have been in the trash for more than 30 days.',
    suggestedCron: '17 3 * * *',
    timeoutMinutes: 30,
    destructive: true,
  },
  'uploads.purgeStaging': {
    description: 'Delete staged upload objects older than 24 hours that never became a drawing.',
    suggestedCron: '41 4 * * *',
    timeoutMinutes: 30,
    destructive: true,
  },
  'versions.enforceCap': {
    description: 'Trim drawing version history beyond MAX_VERSIONS_PER_DRAWING.',
    suggestedCron: '23 5 * * 0',
    timeoutMinutes: 60,
    destructive: true,
  },
  'storage.sweepOrphans': {
    description: 'Delete objects in the bucket that no drawing row points at.',
    suggestedCron: '47 2 * * 0',
    timeoutMinutes: 60,
    destructive: true,
  },
  'webhooks.replayFailed': {
    description: 'Re-apply Dodo webhook deliveries that were recorded but never processed.',
    suggestedCron: '*/29 * * * *',
    timeoutMinutes: 15,
    destructive: false,
  },
  'alerts.check': {
    description: 'Email owners when webhook failures, storage or sign-ups cross their thresholds.',
    suggestedCron: '13 * * * *',
    timeoutMinutes: 10,
    destructive: false,
  },
} as const satisfies Record<string, JobDefinition>;

export type JobName = keyof typeof JOB_REGISTRY;

export const JOB_NAMES = Object.keys(JOB_REGISTRY) as JobName[];

export function isJobName(name: string): name is JobName {
  return Object.prototype.hasOwnProperty.call(JOB_REGISTRY, name);
}

/** Widened back to the interface; see the note in `flag-registry.ts`. */
export function jobDefinition(name: JobName): JobDefinition {
  return JOB_REGISTRY[name] as JobDefinition;
}

/** What a job hands back. Shape is the job's own business. */
export type JobSummary = Record<string, number | string>;
