export interface InstructorCoursesNewTabFocusMarker {
  readonly destination: string;
  readonly requestedAt: number;
  readonly sourcePath: string;
}

export interface InstructorCoursesNewTabFocusRequest {
  readonly destination: string;
  readonly sourcePath: string;
  readonly requestedAt?: number;
}
