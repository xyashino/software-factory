import type { CycleId, JobId, QuestionId, ResumeId } from '../ids';

/** Issues the ULIDs the core needs, injected so tests are deterministic (CORE §5.1). */
export interface Ids {
  jobId(): JobId;
  cycleId(): CycleId;
  resumeId(): ResumeId;
  questionId(): QuestionId;
}
