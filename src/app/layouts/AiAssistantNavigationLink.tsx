import { Bot } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';

import { assistantNavigationTarget } from './app-shell-navigation';
import styles from './AppShell.module.css';

export function AiAssistantNavigationLink() {
  const location = useLocation();
  const target = assistantNavigationTarget(location);
  const tooltipId = `ai-assistant-tooltip-${useId()}`;
  const tooltipTimerRef = useRef<number | null>(null);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [isTooltipFocused, setIsTooltipFocused] = useState(false);
  const [isTooltipEscapeDismissed, setIsTooltipEscapeDismissed] = useState(false);
  const { t } = useTranslation();

  function clearTooltipTimer() {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
  }

  useEffect(() => {
    clearTooltipTimer();
    setIsTooltipVisible(false);
    setIsTooltipFocused(false);
    setIsTooltipEscapeDismissed(false);
    return clearTooltipTimer;
  }, [location.hash, location.pathname, location.search]);

  function openTooltipAfterPointerDelay() {
    if (isTooltipEscapeDismissed) return;
    clearTooltipTimer();
    tooltipTimerRef.current = window.setTimeout(() => {
      setIsTooltipVisible(true);
      tooltipTimerRef.current = null;
    }, 500);
  }

  function closeTooltipAfterPointerLeave() {
    clearTooltipTimer();
    if (!isTooltipFocused) setIsTooltipVisible(false);
  }

  function openTooltipOnFocus() {
    clearTooltipTimer();
    setIsTooltipFocused(true);
    if (!isTooltipEscapeDismissed) setIsTooltipVisible(true);
  }

  function closeTooltipOnBlur() {
    clearTooltipTimer();
    setIsTooltipVisible(false);
    setIsTooltipFocused(false);
    setIsTooltipEscapeDismissed(false);
  }

  return (
    <NavLink
      aria-label={t('a11y:openAiAssistant')}
      aria-describedby={isTooltipVisible ? tooltipId : undefined}
      className={({ isActive }) =>
        [styles.aiAssistantLink, isActive ? styles.aiAssistantLinkActive : null]
          .filter(Boolean)
          .join(' ')
      }
      onBlur={closeTooltipOnBlur}
      onFocus={openTooltipOnFocus}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        clearTooltipTimer();
        setIsTooltipVisible(false);
        setIsTooltipEscapeDismissed(true);
      }}
      onPointerEnter={openTooltipAfterPointerDelay}
      onPointerLeave={closeTooltipAfterPointerLeave}
      state={target.state}
      to={target.to}
    >
      <Bot aria-hidden="true" focusable="false" size={28} strokeWidth={1.75} />
      {isTooltipVisible ? (
        <span id={tooltipId} className={styles.aiAssistantTooltip} role="tooltip">
          {t('common:aiChat')}
        </span>
      ) : null}
    </NavLink>
  );
}
