import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent, type RefObject } from 'react';

import { useSession } from '@features/auth-session';

import { signup, type SignupInput } from './api';
import {
  useAuthErrorFocus,
  useSubmissionAttemptLifecycle,
  type SubmissionAttempt,
} from './AuthForm';
import { authWorkflowMutationKeys } from './mutation-keys';
import {
  compactFieldErrors,
  mapAuthFailure,
  validateSignup,
  type AuthFieldErrors,
  type AuthMessage,
} from './validation';

const INITIAL: SignupInput = {
  email: '',
  name: '',
  surname: '',
  password: '',
  passwordConfirmation: '',
  role: 'student',
};
const FIELD_ORDER = [
  'email',
  'name',
  'surname',
  'role',
  'password',
  'passwordConfirmation',
] as const;

interface SignupMutationVariables {
  readonly attempt: SubmissionAttempt;
  readonly values: SignupInput;
}

type SignupInputValue<TKey extends keyof SignupInput> = SignupInput[TKey];

export interface SignupWorkflow {
  readonly fieldErrors: AuthFieldErrors;
  readonly input: SignupInput;
  readonly isPending: boolean;
  readonly summary: AuthMessage | null;
  readonly summaryRef: RefObject<HTMLDivElement>;
  submit(event: FormEvent): Promise<void>;
  update<K extends keyof SignupInput>(key: K, value: SignupInputValue<K>): void;
}

export function useSignupWorkflow(ownerKey: string): SignupWorkflow {
  const session = useSession();
  const [input, setInput] = useState(INITIAL);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [summary, setSummary] = useState<AuthMessage | null>(null);
  const { ref: summaryRef, requestFocus: requestSummaryFocus } = useAuthErrorFocus(
    summary,
    fieldErrors,
    FIELD_ORDER,
  );
  const attempts = useSubmissionAttemptLifecycle(ownerKey);
  const mutation = useMutation({
    mutationKey: authWorkflowMutationKeys.signup,
    mutationFn: ({ attempt, values }: SignupMutationVariables) =>
      signup(session, values, attempt.identity, attempt.signal),
    gcTime: 0,
    retry: false,
  });
  const update = <K extends keyof SignupInput>(key: K, value: SignupInputValue<K>) => {
    setInput((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const remaining = { ...current };
      delete remaining[key];
      return remaining;
    });
    if (fieldErrors[key]) setSummary(null);
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    const attempt = attempts.begin();
    if (!attempt) return;
    const values = {
      ...input,
      email: input.email.trim(),
      name: input.name.trim(),
      surname: input.surname.trim(),
    };
    const validation = compactFieldErrors(validateSignup(values));
    if (Object.keys(validation).length > 0) {
      setFieldErrors(validation);
      setSummary({ kind: 'review-highlighted-fields' });
      requestSummaryFocus();
      attempts.finish(attempt);
      return;
    }
    setFieldErrors({});
    setSummary(null);
    try {
      const token = await mutation.mutateAsync({ attempt, values });
      if (!attempts.isCurrent(attempt)) return;
      session.acceptAccessToken(token.accessToken);
      if (!attempts.isCurrent(attempt)) return;
      setInput((current) => ({ ...current, password: '', passwordConfirmation: '' }));
    } catch (error) {
      if (!attempts.isCurrent(attempt)) return;
      const failure = mapAuthFailure(error, 'signup');
      setFieldErrors(failure.fields);
      setSummary(failure.summary);
      requestSummaryFocus();
    } finally {
      if (attempts.finish(attempt)) mutation.reset();
    }
  }
  return { fieldErrors, input, isPending: mutation.isPending, summary, summaryRef, submit, update };
}
