export interface StagedBackendCheckOptions {
  snapshotRoot: string;
  repositoryRoot: string;
}

export function runStagedBackendCheck(options: StagedBackendCheckOptions): Promise<void>;
