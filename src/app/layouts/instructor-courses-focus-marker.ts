import type {
  InstructorCoursesNewTabFocusMarker,
  InstructorCoursesNewTabFocusRequest,
} from './instructor-courses-focus-marker-types';

const INSTRUCTOR_COURSES_PATH = '/instructor/courses';
const INSTRUCTOR_COURSES_NEW_TAB_FOCUS_KEY = 'learnhub.instructor-courses.new-tab-focus';
const INSTRUCTOR_COURSES_NEW_TAB_FOCUS_MAX_AGE_MS = 30_000;

function isInstructorCoursesNewTabFocusMarker(
  value: unknown,
): value is InstructorCoursesNewTabFocusMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'destination' in value &&
    typeof value.destination === 'string' &&
    'requestedAt' in value &&
    typeof value.requestedAt === 'number' &&
    Number.isFinite(value.requestedAt) &&
    Number.isSafeInteger(value.requestedAt) &&
    'sourcePath' in value &&
    typeof value.sourcePath === 'string'
  );
}

export function requestInstructorCoursesNewTabFocus({
  destination,
  sourcePath,
  requestedAt = Date.now(),
}: InstructorCoursesNewTabFocusRequest): void {
  if (destination !== INSTRUCTOR_COURSES_PATH) return;
  try {
    const marker: InstructorCoursesNewTabFocusMarker = { destination, requestedAt, sourcePath };
    window.localStorage.setItem(INSTRUCTOR_COURSES_NEW_TAB_FOCUS_KEY, JSON.stringify(marker));
  } catch {
    // Focus restoration is progressive enhancement when local storage is unavailable.
  }
}

export function claimInstructorCoursesNewTabFocus(
  pathname: string,
  referrer = document.referrer,
  now = Date.now(),
): boolean {
  if (pathname !== INSTRUCTOR_COURSES_PATH) return false;
  try {
    const serialized = window.localStorage.getItem(INSTRUCTOR_COURSES_NEW_TAB_FOCUS_KEY);
    if (!serialized) return false;
    // Retire before parsing so an invalid receiver cannot leave a replayable request behind.
    window.localStorage.removeItem(INSTRUCTOR_COURSES_NEW_TAB_FOCUS_KEY);
    const marker: unknown = JSON.parse(serialized);
    if (!isInstructorCoursesNewTabFocusMarker(marker)) return false;
    const referrerUrl = new URL(referrer);
    return (
      marker.destination === pathname &&
      referrerUrl.origin === window.location.origin &&
      marker.sourcePath === referrerUrl.pathname &&
      now - marker.requestedAt >= 0 &&
      now - marker.requestedAt <= INSTRUCTOR_COURSES_NEW_TAB_FOCUS_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}
