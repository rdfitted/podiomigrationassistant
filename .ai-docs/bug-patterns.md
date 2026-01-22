# Bug Patterns - Podio Migration Agent

Common bug patterns and their fixes for this project.

> Last updated: 2026-01-22

## React Hooks

### Race Condition in Async useEffect

**Bug**: useEffect with async fetch operations can cause stale data overwrites or state updates on unmounted components.

**Symptom**:
- Rapid user interactions (toggling panels, changing tabs) cause data flickering
- Console warnings about "Can't perform a React state update on an unmounted component"
- Older fetch results overwriting newer data

**Root Cause**:
- No cleanup function to abort pending fetches
- No guard to prevent state updates after unmount
- Missing AbortController signal on fetch calls

**Fix Pattern**:
```typescript
useEffect(() => {
  const abortController = new AbortController();
  let isMounted = true;

  async function fetchData() {
    try {
      const response = await fetch(url, { signal: abortController.signal });
      if (response.ok && isMounted) {
        const data = await response.json();
        setState(data);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Fetch failed:', err);
    } finally {
      if (isMounted) setLoading(false);
    }
  }

  fetchData();

  return () => {
    isMounted = false;
    abortController.abort();
  };
}, [dependencies]);
```

**Learned**: 20260121-145015, 20260122 (fix-comment session)

---

### Stale Closure in Empty Dependency Array

**Bug**: useEffect with empty `[]` dependency array but uses props/state from closure.

**Symptom**:
- Effect uses outdated prop values
- eslint-disable comment hiding the warning
- Feature works on mount but fails when props change

**Root Cause**:
- Developer intentionally uses empty deps to "run only on mount"
- But effect body references props that can change
- Stale closure captures initial prop value forever

**Fix Pattern**:
```typescript
// WRONG - stale closure
useEffect(() => {
  if (condition && storedData.appId === appId) { // appId captured at mount
    doSomething();
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // appId missing!

// CORRECT - include prop in deps
useEffect(() => {
  if (condition && storedData.appId === appId) {
    doSomething();
  }
}, [appId]); // Effect re-runs when appId changes
```

**Learned**: 20260122 (fix-comment session)

---

## TypeScript Types

### Interface Field Duplication

**Bug**: Interface duplicates fields from another interface instead of extending it.

**Symptom**:
- Two interfaces with same fields
- Changes to base interface don't propagate
- Maintenance burden increases

**Root Cause**:
- Copy-paste during development
- Different optional modifiers (`?` vs required)
- Lack of awareness of base interface

**Fix Pattern**:
```typescript
// WRONG - duplicated fields
interface ExtendedProgress {
  total?: number;
  processed?: number;
  successful?: number;
  failed?: number;
  percent?: number;
  customField?: number;
}

// CORRECT - extend and override
import { BaseProgress } from './base-types';

interface ExtendedProgress extends Partial<BaseProgress> {
  customField?: number;
}
```

**Learned**: 20260122 (fix-comment session)

---

## localStorage / Client State

### SSR Incompatibility

**Bug**: Code accesses `window` or `localStorage` at module load time.

**Symptom**:
- "window is not defined" error during SSR
- Build failures in Next.js
- Hydration mismatches

**Root Cause**:
- Module-level code assumes browser environment
- Missing SSR safety checks

**Fix Pattern**:
```typescript
// WRONG
const stored = localStorage.getItem('key'); // Crashes on server

// CORRECT
function getStoredValue() {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('key');
  } catch {
    return null; // Handle SecurityError in incognito
  }
}
```

**Learned**: 20260121-145015

---

### Missing Error Handling for Storage

**Bug**: localStorage operations without try-catch.

**Symptom**:
- Crashes in incognito mode (SecurityError)
- Crashes when storage is full (QuotaExceededError)
- Silent failures in private browsing

**Root Cause**:
- Assumption that localStorage always works
- Missing error boundaries

**Fix Pattern**:
```typescript
function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === 'QuotaExceededError') {
        console.warn('Storage quota exceeded');
      } else if (err.name === 'SecurityError') {
        console.warn('Storage access denied');
      }
    }
    return false;
  }
}
```

**Learned**: 20260121-145015

---

## Sessions Contributing

| Session | Bugs Identified |
|---------|-----------------|
| 20260121-145015 | SSR safety, storage errors, race conditions |
| 20260122 (fix-comment) | AbortController pattern, stale closures, type duplication |
