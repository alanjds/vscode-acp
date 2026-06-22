import { memo } from 'react';
import type { JSX } from 'react';

import type { SessionSnapshot } from '../chatTypes';
import { Codicon } from './Codicon';

export type SessionBannerProps = {
  visible: boolean;
  sessionState: SessionSnapshot | null;
  isProcessing: boolean;
  onOpenDebugSnapshot: () => void;
};

function SessionBannerComponent({
  visible,
  sessionState,
  isProcessing,
  onOpenDebugSnapshot,
}: SessionBannerProps): JSX.Element {
  const contextFamily = sessionState?.contextFamily;
  const contextFamilyLabel = contextFamily
    ? contextFamily.contextLinkedFrom
      ? `Context family · from ${contextFamily.contextLinkedFrom.agentName}`
      : 'Context family'
    : null;

  return (
    <div className={`session-banner${visible ? ' visible' : ''}`}>
      <Codicon
        className="session-status-icon"
        name={visible ? 'debug-start' : 'debug-disconnect'}
        title={visible ? 'Connected' : 'Disconnected'}
      />
      <div className="info">
        <div className="agent-row">
          <span className="agent">{sessionState?.title || sessionState?.agentName || 'Agent'}</span>
          {visible ? <span className="status-badge">Connected</span> : null}
        </div>
        {sessionState?.cwd ? (
          <div className="cwd" title={sessionState.cwd}>
            {sessionState.cwd}
          </div>
        ) : null}
        <div className="session-chips">
          {contextFamilyLabel ? <span className="session-chip context-family">{contextFamilyLabel}</span> : null}
          {sessionState?.pendingSharedContext ? (
            <span className="session-chip pending-shared-context">Next prompt includes shared context</span>
          ) : null}
        </div>
      </div>
      <span className="status">{isProcessing ? <span className="spinner" /> : null}</span>
      <button
        className="banner-debug-btn"
        title="Open debug snapshot"
        type="button"
        onClick={onOpenDebugSnapshot}
      >
        <Codicon name="debug" />
      </button>
    </div>
  );
}

export const SessionBanner = memo(SessionBannerComponent);
