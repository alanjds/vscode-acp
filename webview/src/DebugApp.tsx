import { useEffect, useMemo, useState, type JSX } from 'react';

import type { DebugEvent, DebugSnapshot } from './chatTypes';
import { onMessage, postMessage } from './vscode';

type CategoryFilter = 'all' | string;
type DirectionFilter = 'all' | 'send' | 'recv';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getActiveSessionLabel(snapshot: DebugSnapshot): string {
  const session = snapshot.activeSession;
  if (!session) {
    return 'No active session';
  }
  const title = typeof session.title === 'string' ? session.title : undefined;
  const agent = typeof session.agentDisplayName === 'string'
    ? session.agentDisplayName
    : typeof session.agentName === 'string'
      ? session.agentName
      : 'Agent';
  const sessionId = typeof session.sessionId === 'string' ? session.sessionId : '';
  return [title || agent, sessionId].filter(Boolean).join(' · ');
}

function getEventText(event: DebugEvent): string {
  return [
    event.timestamp,
    event.category,
    event.direction,
    event.agentId,
    event.sessionId,
    event.method,
    event.status,
    stringify(event.payload),
  ].filter(Boolean).join('\n');
}

function getEventTitle(event: DebugEvent): string {
  return event.method || event.status || event.category;
}

function isDebugSnapshot(value: unknown): value is DebugSnapshot {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as Partial<DebugSnapshot>).version === 1 &&
    (value as Partial<DebugSnapshot>).trace &&
    Array.isArray((value as Partial<DebugSnapshot>).trace?.events),
  );
}

export function DebugApp(): JSX.Element {
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [sessionFilter, setSessionFilter] = useState('');
  const [toolCallFilter, setToolCallFilter] = useState('');

  useEffect(() => {
    postMessage({ type: 'ready' });
    return onMessage((message) => {
      if (message.type === 'debugSnapshot' && isDebugSnapshot(message.snapshot)) {
        const nextSnapshot = message.snapshot;
        setSnapshot(nextSnapshot);
        const firstEventId = nextSnapshot.trace.events[0]?.id ?? null;
        setSelectedEventId(currentId =>
          currentId && nextSnapshot.trace.events.some((event) => event.id === currentId)
            ? currentId
            : firstEventId,
        );
      }
    });
  }, []);

  const events = snapshot?.trace.events ?? [];
  const categories = useMemo(
    () => Array.from(new Set(events.map(event => event.category))).sort(),
    [events],
  );

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedSession = sessionFilter.trim().toLowerCase();
    const normalizedToolCall = toolCallFilter.trim().toLowerCase();

    return events.filter((event) => {
      if (category !== 'all' && event.category !== category) {
        return false;
      }
      if (direction !== 'all' && event.direction !== direction) {
        return false;
      }
      if (normalizedSession && !(event.sessionId || '').toLowerCase().includes(normalizedSession)) {
        return false;
      }
      const eventText = getEventText(event).toLowerCase();
      if (normalizedToolCall && !eventText.includes(normalizedToolCall)) {
        return false;
      }
      return !normalizedQuery || eventText.includes(normalizedQuery);
    });
  }, [category, direction, events, query, sessionFilter, toolCallFilter]);

  const selectedEvent = filteredEvents.find(event => event.id === selectedEventId)
    ?? filteredEvents[0]
    ?? null;

  return (
    <div className="debug-root">
      <header className="debug-header">
        <div className="debug-title-wrap">
          <h1>ACP Debug</h1>
          <div className="debug-subtitle">
            {snapshot ? getActiveSessionLabel(snapshot) : 'Waiting for snapshot'}
          </div>
        </div>
        <div className="debug-actions">
          <button type="button" onClick={() => postMessage({ type: 'refreshDebugSnapshot' })}>
            Refresh
          </button>
          <button type="button" onClick={() => postMessage({ type: 'copyDebugSnapshot' })}>
            Copy JSON
          </button>
          <button type="button" onClick={() => postMessage({ type: 'exportDebugSnapshot' })}>
            Export JSON
          </button>
        </div>
      </header>

      {snapshot ? (
        <>
          <section className="debug-summary">
            <div>
              <span className="debug-label">Generated</span>
              <strong>{snapshot.generatedAt}</strong>
            </div>
            <div>
              <span className="debug-label">Extension</span>
              <strong>{snapshot.extension.version}</strong>
            </div>
            <div>
              <span className="debug-label">Events</span>
              <strong>{snapshot.trace.eventCount}</strong>
            </div>
            <div>
              <span className="debug-label">Dropped</span>
              <strong>{snapshot.trace.droppedEvents}</strong>
            </div>
            <div>
              <span className="debug-label">Buffer</span>
              <strong>{formatBytes(snapshot.trace.totalBytes)}</strong>
            </div>
          </section>

          <section className="debug-session">
            <pre>{stringify(snapshot.activeSession)}</pre>
          </section>

          <section className="debug-filters">
            <input
              aria-label="Search"
              placeholder="Search raw events"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <select
              aria-label="Category"
              value={category}
              onChange={(event) => setCategory(event.currentTarget.value)}
            >
              <option value="all">All categories</option>
              {categories.map((candidate) => (
                <option key={candidate} value={candidate}>{candidate}</option>
              ))}
            </select>
            <select
              aria-label="Direction"
              value={direction}
              onChange={(event) => setDirection(event.currentTarget.value as DirectionFilter)}
            >
              <option value="all">All directions</option>
              <option value="send">send</option>
              <option value="recv">recv</option>
            </select>
            <input
              aria-label="Session ID"
              placeholder="sessionId"
              type="search"
              value={sessionFilter}
              onChange={(event) => setSessionFilter(event.currentTarget.value)}
            />
            <input
              aria-label="Tool call"
              placeholder="toolCallId"
              type="search"
              value={toolCallFilter}
              onChange={(event) => setToolCallFilter(event.currentTarget.value)}
            />
          </section>

          <main className="debug-main">
            <div className="debug-events" role="list">
              {filteredEvents.length === 0 ? (
                <div className="debug-empty">No events match the filters.</div>
              ) : filteredEvents.map((event) => (
                <button
                  className={`debug-event${selectedEvent?.id === event.id ? ' selected' : ''}`}
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedEventId(event.id)}
                >
                  <span className="debug-event-time">{event.timestamp}</span>
                  <span className="debug-event-title">{getEventTitle(event)}</span>
                  <span className="debug-event-meta">
                    {[event.category, event.direction, event.status, event.durationMs !== undefined ? `${event.durationMs}ms` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              ))}
            </div>
            <div className="debug-detail">
              <pre>{selectedEvent ? stringify(selectedEvent) : 'No event selected.'}</pre>
            </div>
          </main>
        </>
      ) : (
        <div className="debug-loading">Loading debug snapshot...</div>
      )}
    </div>
  );
}
