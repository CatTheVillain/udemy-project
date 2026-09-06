// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CourseReviews } from '@features/course-reviews';
import { useCourseReviews } from '@features/course-reviews/useCourseReviews';
import { localeRuntime } from '@shared/locale';

vi.mock('@features/course-reviews/useCourseReviews', () => ({ useCourseReviews: vi.fn() }));

const mockUseCourseReviews = vi.mocked(useCourseReviews);
const removedReviewCopy = new Map<string, string>();
const reviewCopyKeys = [
  'noReviewsDescription',
  'reviewCommentPrompt',
  'reviewCommentPlaceholder',
] as const;

interface ReviewPanelQueryState {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly data?: {
    readonly items: readonly {
      readonly id: number;
      readonly rating: number | null;
      readonly comment: string | null;
    }[];
    readonly page: number;
    readonly pages: number;
    readonly has_next: boolean;
    readonly has_previous: boolean;
  };
  refetch: () => Promise<unknown>;
}

function reviewState(list: ReviewPanelQueryState) {
  return {
    list,
    current: { isSuccess: false },
    page: 1,
    setPage: vi.fn(),
    hasOwnedReview: false,
    noOwnedReview: false,
    ready: false,
    create: { mutate: vi.fn(), isPending: false, error: null },
    update: { mutate: vi.fn(), isPending: false, error: null },
    remove: { mutate: vi.fn(), isPending: false, error: null },
  } as unknown as ReturnType<typeof useCourseReviews>;
}

function renderReviews(canWriteReview = true) {
  return render(
    <I18nextProvider i18n={localeRuntime}>
      <CourseReviews courseId={7} canWriteReview={canWriteReview} />
    </I18nextProvider>,
  );
}

function removeLiveReviewCopy() {
  const courseResources = localeRuntime.getResourceBundle('en', 'course') as Record<string, string>;
  for (const key of reviewCopyKeys) {
    const value = courseResources[key];
    if (typeof value !== 'string') throw new Error(`Expected course locale resource ${key}.`);
    removedReviewCopy.set(key, value);
    delete courseResources[key];
  }
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const [key, value] of removedReviewCopy)
    localeRuntime.addResource('en', 'course', key, value);
  removedReviewCopy.clear();
});

describe('CourseReviews', () => {
  it('renders public review content while current-user ownership is unresolved', () => {
    mockUseCourseReviews.mockReturnValue(
      reviewState({
        isPending: false,
        isError: false,
        data: {
          items: [{ id: 11, rating: 5, comment: 'Clear and useful.' }],
          page: 1,
          pages: 1,
          has_next: false,
          has_previous: false,
        },
        refetch: vi.fn(),
      }),
    );

    renderReviews();

    expect(screen.getByRole('heading', { level: 2, name: 'Reviews' })).toBeTruthy();
    expect(screen.getByText('Clear and useful.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Rating: 5/5' }).querySelectorAll('svg')).toHaveLength(
      5,
    );
    expect(screen.queryByRole('heading', { level: 3, name: 'Write a review' })).toBeNull();
  });

  it('keeps public empty and error states available without an owned-review result', () => {
    removeLiveReviewCopy();
    mockUseCourseReviews.mockReturnValue(
      reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
    );
    const { rerender } = renderReviews();
    expect(screen.getByText('No reviews yet.')).toBeTruthy();
    expect(
      screen.getByText(
        'Be the first to share your opinion about this course. Your review can help other students make a choice.',
      ),
    ).toBeTruthy();

    mockUseCourseReviews.mockReturnValue(
      reviewState({ isPending: false, isError: true, refetch: vi.fn() }),
    );
    rerender(
      <I18nextProvider i18n={localeRuntime}>
        <CourseReviews courseId={7} canWriteReview />
      </I18nextProvider>,
    );
    expect(screen.getByText('Reviews could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reviews' })).toBeTruthy();
  });

  it('starts with empty stars, previews the hovered rating, and submits the selected rating', () => {
    removeLiveReviewCopy();
    const create = { mutate: vi.fn(), isPending: false, error: null };
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      noOwnedReview: true,
      ready: true,
      create,
    } as unknown as ReturnType<typeof useCourseReviews>);

    renderReviews();

    const ratingGroup = screen.getByRole('group', { name: 'Rating' });
    const ratings = within(ratingGroup).getAllByRole('radio');
    expect(ratings).toHaveLength(5);
    expect(ratings.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(
      [...ratingGroup.querySelectorAll('svg')].every(
        (star) => star.getAttribute('fill') === 'none',
      ),
    ).toBe(true);
    const thirdRating = within(ratingGroup).getByRole('radio', { name: 'Rating: 3/5' });
    fireEvent.pointerEnter(thirdRating.closest('label')!);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="preview"]')]).toHaveLength(3);
    fireEvent.pointerLeave(thirdRating.closest('label')!, { relatedTarget: document.body });
    expect([...ratingGroup.querySelectorAll('[data-rating-state="neutral"]')]).toHaveLength(5);
    expect(
      (screen.getByRole('button', { name: 'Save review' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(thirdRating);
    expect(
      (within(ratingGroup).getByRole('radio', { name: 'Rating: 3/5' }) as HTMLInputElement).checked,
    ).toBe(true);

    const save = screen.getByRole('button', { name: 'Save review' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(save.classList.contains('ui-button--full')).toBe(true);
    const comment = screen.getByLabelText('What did you like?') as HTMLTextAreaElement;
    expect(comment.getAttribute('placeholder')).toBe('Tell us more');
    expect(comment.maxLength).toBe(1000);
    expect(screen.getByText('0/1000')).toBeTruthy();
    fireEvent.change(comment, { target: { value: 'a'.repeat(1001) } });
    expect(comment.value).toHaveLength(1000);
    expect(screen.getByText('1000/1000')).toBeTruthy();
    fireEvent.change(comment, { target: { value: 'Clear examples.' } });
    expect(screen.getByText('15/1000')).toBeTruthy();
    fireEvent.submit(save.closest('form')!);
    expect(create.mutate).toHaveBeenCalledWith({ rating: 3, comment: 'Clear examples.' });
  });

  it('keeps native rating nodes stable while pointer and keyboard intent choose one preview state', async () => {
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      noOwnedReview: true,
      ready: true,
    } as unknown as ReturnType<typeof useCourseReviews>);

    renderReviews();

    const ratingGroup = screen.getByRole('group', { name: 'Rating' });
    const three = within(ratingGroup).getByRole('radio', { name: 'Rating: 3/5' });
    const four = within(ratingGroup).getByRole('radio', { name: 'Rating: 4/5' });
    const five = within(ratingGroup).getByRole('radio', { name: 'Rating: 5/5' });
    const initialStars = [...ratingGroup.querySelectorAll('svg')];

    fireEvent.pointerEnter(three.closest('label')!);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="preview"]')]).toHaveLength(3);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="neutral"]')]).toHaveLength(2);

    fireEvent.focus(four);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="preview"]')]).toHaveLength(4);

    fireEvent.pointerMove(three.closest('label')!);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="preview"]')]).toHaveLength(3);
    expect([...ratingGroup.querySelectorAll('svg')]).toEqual(initialStars);

    fireEvent.pointerDown(three.closest('label')!);
    fireEvent.click(three);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="committed"]')]).toHaveLength(3);
    expect((three as HTMLInputElement).checked).toBe(true);
    fireEvent.pointerMove(three.closest('label')!);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="committed"]')]).toHaveLength(3);

    fireEvent.pointerDown(four.closest('label')!, { pointerId: 7 });
    fireEvent.pointerLeave(four.closest('label')!, { relatedTarget: document.body });
    fireEvent.pointerUp(document.body, { pointerId: 7 });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    fireEvent.focus(five);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="preview"]')]).toHaveLength(5);
    fireEvent.click(five);
    expect((five as HTMLInputElement).checked).toBe(true);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="committed"]')]).toHaveLength(5);
  });

  it('promotes the remaining candidate at group exit and suppresses preview until deliberate re-entry', () => {
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      noOwnedReview: true,
      ready: true,
    } as unknown as ReturnType<typeof useCourseReviews>);

    renderReviews();

    const ratingGroup = screen.getByRole('group', { name: 'Rating' });
    const three = within(ratingGroup).getByRole('radio', { name: 'Rating: 3/5' });
    const four = within(ratingGroup).getByRole('radio', { name: 'Rating: 4/5' });
    const threeLabel = three.closest('label')!;
    const fourLabel = four.closest('label')!;

    fireEvent.pointerEnter(threeLabel);
    fireEvent.focus(four);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="preview"]')]).toHaveLength(4);
    fireEvent.pointerLeave(threeLabel, { relatedTarget: document.body });
    expect([...ratingGroup.querySelectorAll('[data-rating-state="preview"]')]).toHaveLength(4);
    fireEvent.blur(four, { relatedTarget: document.body });
    expect([...ratingGroup.querySelectorAll('[data-rating-state="neutral"]')]).toHaveLength(5);

    fireEvent.pointerEnter(threeLabel);
    fireEvent.pointerDown(threeLabel);
    fireEvent.focus(three);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="preview"]')]).toHaveLength(3);
    fireEvent.click(three);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="committed"]')]).toHaveLength(3);
    fireEvent.pointerEnter(threeLabel);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="committed"]')]).toHaveLength(3);
    fireEvent.pointerEnter(fourLabel);
    expect([...ratingGroup.querySelectorAll('[data-rating-state="preview"]')]).toHaveLength(4);
  });

  it('shows the owned review once and opens the edit form only on request', () => {
    const update = { mutate: vi.fn(), isPending: false, error: null };
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: {
          items: [
            { id: 11, rating: 4, comment: 'Useful examples.' },
            { id: 12, rating: 5, comment: 'Clear structure.' },
          ],
          page: 1,
          pages: 1,
          has_next: false,
          has_previous: false,
        },
        refetch: vi.fn(),
      }),
      current: {
        isSuccess: true,
        data: { id: 11, rating: 4, comment: 'Useful examples.' },
      },
      hasOwnedReview: true,
      ready: true,
      update,
    } as unknown as ReturnType<typeof useCourseReviews>);
    renderReviews();

    expect(screen.getByRole('heading', { level: 3, name: 'Your review' })).toBeTruthy();
    expect(screen.getAllByText('Useful examples.')).toHaveLength(1);
    expect(screen.getByText('Clear structure.')).toBeTruthy();
    expect(screen.getByText('Edit review')).toBeTruthy();
    const deleteReview = screen.getByRole('button', { name: 'Delete review' });
    expect(deleteReview.textContent).toBe('');
    expect(deleteReview.querySelector('.lucide-trash-2')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 3, name: 'Edit your review' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit your review' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Edit your review' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Rating: 4/5' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByLabelText('What did you like?') as HTMLTextAreaElement).value).toBe(
      'Useful examples.',
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);
    expect(update.mutate).toHaveBeenCalledWith(
      { rating: 4, comment: 'Useful examples.' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    const updateOptions = update.mutate.mock.calls[0]?.[1] as { onSuccess?: () => void };
    act(() => updateOptions.onSuccess?.());
    expect(screen.queryByRole('heading', { level: 3, name: 'Edit your review' })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Your review' })).toBeTruthy();
  });

  it('cancels owned-review editing and restores the saved values', () => {
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: {
          items: [{ id: 11, rating: 4, comment: 'Useful examples.' }],
          page: 1,
          pages: 1,
          has_next: false,
          has_previous: false,
        },
        refetch: vi.fn(),
      }),
      current: {
        isSuccess: true,
        data: { id: 11, rating: 4, comment: 'Useful examples.' },
      },
      hasOwnedReview: true,
      ready: true,
    } as unknown as ReturnType<typeof useCourseReviews>);
    renderReviews();
    fireEvent.click(screen.getByRole('button', { name: 'Edit your review' }));
    fireEvent.change(screen.getByLabelText('What did you like?'), {
      target: { value: 'Unsaved change.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { level: 3, name: 'Edit your review' })).toBeNull();
    expect(screen.getAllByText('Useful examples.')).toHaveLength(1);
  });

  it('resets the create form when owned-review lookup becomes absent', () => {
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      current: { isSuccess: true, data: { id: 11, rating: 4, comment: 'Useful examples.' } },
      hasOwnedReview: true,
      ready: true,
    } as unknown as ReturnType<typeof useCourseReviews>);
    const { rerender } = renderReviews();

    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      noOwnedReview: true,
      ready: true,
    } as unknown as ReturnType<typeof useCourseReviews>);
    rerender(
      <I18nextProvider i18n={localeRuntime}>
        <CourseReviews courseId={7} canWriteReview />
      </I18nextProvider>,
    );
    expect(
      screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked),
    ).toBe(true);
    expect((screen.getByLabelText('What did you like?') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps public reviews visible but hides the review form without course access', () => {
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      noOwnedReview: true,
      ready: true,
    } as unknown as ReturnType<typeof useCourseReviews>);

    renderReviews(false);

    expect(screen.getByText('No reviews yet.')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 3, name: 'Write a review' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Rating' })).toBeNull();
  });

  it('uses canonical safe recovery copy instead of a raw create failure', () => {
    const rawCreateError = 'raw-create-server-detail@example.invalid';
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      noOwnedReview: true,
      create: { mutate: vi.fn(), isPending: false, error: new Error(rawCreateError) },
    } as unknown as ReturnType<typeof useCourseReviews>);

    renderReviews();

    expect(screen.getByText('Unable to complete action')).toBeTruthy();
    expect(screen.getByText('Please try again.')).toBeTruthy();
    expect(screen.queryByText(rawCreateError)).toBeNull();
  });

  it('uses canonical safe recovery copy instead of a raw update failure', () => {
    const rawUpdateError = 'raw-update-server-detail@example.invalid';
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      current: { isSuccess: true, data: { rating: 5, comment: 'Existing review.' } },
      hasOwnedReview: true,
      update: { mutate: vi.fn(), isPending: false, error: new Error(rawUpdateError) },
    } as unknown as ReturnType<typeof useCourseReviews>);

    renderReviews();

    fireEvent.click(screen.getByRole('button', { name: 'Edit your review' }));

    expect(screen.getByText('Unable to complete action')).toBeTruthy();
    expect(screen.getByText('Please try again.')).toBeTruthy();
    expect(screen.queryByText(rawUpdateError)).toBeNull();
  });

  it('uses canonical safe recovery copy instead of a raw delete failure', () => {
    const rawDeleteError = 'raw-delete-server-detail@example.invalid';
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      current: { isSuccess: true, data: { rating: 5, comment: 'Existing review.' } },
      hasOwnedReview: true,
      remove: { mutate: vi.fn(), isPending: false, error: new Error(rawDeleteError) },
    } as unknown as ReturnType<typeof useCourseReviews>);

    renderReviews();
    fireEvent.click(screen.getByRole('button', { name: 'Delete review' }));

    expect(screen.getByText('Unable to complete action')).toBeTruthy();
    expect(screen.getByText('Please try again.')).toBeTruthy();
    expect(screen.queryByText(rawDeleteError)).toBeNull();
  });

  it('focuses the reviews heading only after a successful delete closes the dialog', () => {
    const remove = {
      mutate: vi.fn((_: undefined, options: { onSuccess?: () => void }) => options.onSuccess?.()),
      isPending: false,
      error: null,
    };
    mockUseCourseReviews.mockReturnValue({
      ...reviewState({
        isPending: false,
        isError: false,
        data: { items: [], page: 1, pages: 0, has_next: false, has_previous: false },
        refetch: vi.fn(),
      }),
      current: { isSuccess: true, data: { rating: 5, comment: 'Existing review.' } },
      hasOwnedReview: true,
      remove,
    } as unknown as ReturnType<typeof useCourseReviews>);

    renderReviews();
    fireEvent.click(screen.getByRole('button', { name: 'Delete review' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete review' }),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Reviews' }));
  });
});
