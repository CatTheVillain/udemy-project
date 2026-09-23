export type SessionCacheEpoch = string & { readonly __sessionCacheEpoch: unique symbol };

export function instructorCourseQueryKey(epoch: SessionCacheEpoch, courseId: number) {
  return ['private', epoch, 'instructor', 'course', courseId] as const;
}

export function instructorLessonQueryKey(epoch: SessionCacheEpoch, lessonId: number) {
  return ['private', epoch, 'instructor', 'lesson', lessonId] as const;
}

export function instructorCourseCollectionQueryKey(epoch: SessionCacheEpoch, page: number) {
  return ['private', epoch, 'instructor', 'courses', page] as const;
}

export function instructorCourseCollectionQueryPrefix(epoch: SessionCacheEpoch) {
  return ['private', epoch, 'instructor', 'courses'] as const;
}

export function instructorCourseRosterQueryKey(
  epoch: SessionCacheEpoch,
  courseId: number,
  page: number,
) {
  return ['private', epoch, 'instructor', 'roster', courseId, page] as const;
}

export function isPrivateQueryForEpoch(
  queryKey: readonly unknown[],
  epoch: SessionCacheEpoch,
): boolean {
  return queryKey[0] === 'private' && queryKey[1] === epoch;
}
