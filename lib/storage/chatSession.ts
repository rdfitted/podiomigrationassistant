/**
 * Chat session storage adapter with localStorage
 *
 * Provides SSR-safe storage operations with versioning and error handling
 */

import type { SerializedSession, ChatMessage } from '../chat/types';

const STORAGE_KEY_PREFIX = 'podio-agent:chat:';
const STORAGE_VERSION = 1;

/**
 * Check if localStorage is available (guards against SSR)
 */
function isLocalStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const testKey = '__test__';
    window.localStorage.setItem(testKey, 'test');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get storage key for a session ID
 */
function getStorageKey(sessionId: string = 'default'): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

/**
 * Load session from localStorage
 */
export function loadSession(sessionId: string = 'default'): SerializedSession | null {
  if (!isLocalStorageAvailable()) return null;

  try {
    const key = getStorageKey(sessionId);
    const data = window.localStorage.getItem(key);

    if (!data) return null;

    const parsed = JSON.parse(data) as SerializedSession;

    // Validate version
    if (parsed.version !== STORAGE_VERSION) {
      console.warn(
        `[ChatSession] Version mismatch (stored: ${parsed.version}, current: ${STORAGE_VERSION}), clearing session`
      );
      clearSession(sessionId);
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[ChatSession] Failed to load session:', error);
    return null;
  }
}

/**
 * Save session to localStorage
 */
export function saveSession(
  sessionId: string = 'default',
  messages: ChatMessage[]
): boolean {
  if (!isLocalStorageAvailable()) return false;

  try {
    const key = getStorageKey(sessionId);
    const now = new Date().toISOString();

    // Get existing session to preserve createdAt
    const existing = loadSession(sessionId);

    const session: SerializedSession = {
      version: STORAGE_VERSION,
      id: sessionId,
      messages,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    window.localStorage.setItem(key, JSON.stringify(session));
    return true;
  } catch (error) {
    console.error('[ChatSession] Failed to save session:', error);

    // Check for quota exceeded error
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      console.warn('[ChatSession] localStorage quota exceeded');
    }

    return false;
  }
}

/**
 * Clear session from localStorage
 */
export function clearSession(sessionId: string = 'default'): void {
  if (!isLocalStorageAvailable()) return;

  try {
    const key = getStorageKey(sessionId);
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error('[ChatSession] Failed to clear session:', error);
  }
}

/**
 * Get all session IDs
 */
export function getAllSessionIds(): string[] {
  if (!isLocalStorageAvailable()) return [];

  try {
    const ids: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        const id = key.replace(STORAGE_KEY_PREFIX, '');
        ids.push(id);
      }
    }
    return ids;
  } catch (error) {
    console.error('[ChatSession] Failed to get session IDs:', error);
    return [];
  }
}

/**
 * Clear all sessions
 */
export function clearAllSessions(): void {
  if (!isLocalStorageAvailable()) return;

  try {
    const ids = getAllSessionIds();
    ids.forEach((id) => clearSession(id));
  } catch (error) {
    console.error('[ChatSession] Failed to clear all sessions:', error);
  }
}

/**
 * Export session to downloadable format
 */
export function exportSessionToJSON(sessionId: string = 'default'): Blob | null {
  const session = loadSession(sessionId);
  if (!session) return null;

  try {
    const json = JSON.stringify(session, null, 2);
    return new Blob([json], { type: 'application/json' });
  } catch (error) {
    console.error('[ChatSession] Failed to export session to JSON:', error);
    return null;
  }
}

/**
 * Export session to Markdown format
 */
export function exportSessionToMarkdown(sessionId: string = 'default'): Blob | null {
  const session = loadSession(sessionId);
  if (!session) return null;

  try {
    const lines: string[] = [];

    lines.push(`# Chat Session: ${session.id}`);
    lines.push(`**Created**: ${new Date(session.createdAt).toLocaleString()}`);
    lines.push(`**Updated**: ${new Date(session.updatedAt).toLocaleString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const message of session.messages) {
      const role = message.role.toUpperCase();
      const timestamp = message.timestamp
        ? new Date(message.timestamp).toLocaleString()
        : 'Unknown';

      lines.push(`## ${role} (${timestamp})`);
      lines.push('');
      lines.push(message.content);
      lines.push('');

      // Add tool invocations if present
      if (message.toolInvocations && message.toolInvocations.length > 0) {
        lines.push('### Tool Calls');
        lines.push('');

        for (const invocation of message.toolInvocations) {
          lines.push(`- **${invocation.toolName}** (${invocation.state})`);

          if (invocation.args) {
            lines.push('  - Args:');
            lines.push('    ```json');
            lines.push(`    ${JSON.stringify(invocation.args, null, 2)}`);
            lines.push('    ```');
          }

          if ('result' in invocation && invocation.result !== undefined) {
            lines.push('  - Result:');
            lines.push('    ```json');
            lines.push(`    ${JSON.stringify(invocation.result, null, 2)}`);
            lines.push('    ```');
          }
        }

        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    const markdown = lines.join('\n');
    return new Blob([markdown], { type: 'text/markdown' });
  } catch (error) {
    console.error('[ChatSession] Failed to export session to Markdown:', error);
    return null;
  }
}
