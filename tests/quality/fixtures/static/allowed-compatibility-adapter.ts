export interface SessionActions {
  requestPublic(): void;
}

// quality-exception: TS-TYPE-002 RequestAdapter SessionActions.requestPublic exact compatibility adapter.
export type RequestAdapter = SessionActions['requestPublic'];
