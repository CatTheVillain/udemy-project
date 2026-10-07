import { useMemo, useState } from 'react';

import type { ExclusiveDisclosureControl } from '@shared/types';

import type { HeaderDisclosure } from './app-shell-types';

export interface HeaderDisclosureControls {
  readonly account: ExclusiveDisclosureControl;
  readonly language: ExclusiveDisclosureControl;
}

/** The header alone arbitrates mutually exclusive account and language disclosures. */
export function useHeaderDisclosureControls(): HeaderDisclosureControls {
  const [activeDisclosure, setActiveDisclosure] = useState<HeaderDisclosure | null>(null);

  return useMemo(
    () => ({
      account: {
        closeRequested: activeDisclosure === 'language',
        requestOpen: () => setActiveDisclosure('account'),
      },
      language: {
        closeRequested: activeDisclosure === 'account',
        requestOpen: () => setActiveDisclosure('language'),
      },
    }),
    [activeDisclosure],
  );
}
