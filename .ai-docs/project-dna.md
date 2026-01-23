# Project DNA - Podio Migration Agent

*Last curated: 2026-01-22*
*Based on: 6 session learnings*

## Core Patterns

### What Works

**Multi-Agent Workflows**
- Sequential worker pattern (implementation→coherence→simplification) ensures clean layer separation - Used in 3 sessions
- Parallel reviewers catch complementary issues (8 issues caught in one session)
- Session guidelines codification upfront prevents implementation issues - Zero reviewer issues when done right
- Multi-agent verification (4 models) with tie-breaker consensus works for nuanced decisions

**Filter Infrastructure**
- Reusing existing filter infrastructure (ItemMigrationFilters, convertFilters) accelerates feature development
- Filter conversion layer (user-friendly → API format) provides clean separation of concerns
- Filter persistence in job metadata enables reproducibility

**React Hooks Best Practices**
- `useMemo` for derived state (tri-state logic, pagination) - better than `useEffect`
- `useRef` + `useEffect` for DOM-only properties (`indeterminate`)
- Async `useEffect` needs `AbortController` + `isMounted` guard to prevent race conditions
- Props in effect body MUST be in dependency array - never suppress eslint
- Follow existing patterns in same file for consistency

**State Persistence**
- localStorage requires SSR safety (`typeof window` check), QuotaExceededError/SecurityError handling
- Schema validation for JSON parsing prevents crashes from corrupted storage
- TTL-based expiration prevents stale data accumulation
- Auto-reconnect logic needs AbortController to prevent mount race conditions

**Accessibility Standards**
- `aria-checked` should NOT be added to native HTML checkboxes - only for ARIA `role="checkbox"`
- Native checkboxes expose `indeterminate` state automatically to assistive tech
- Web standards research (W3C/MDN) essential for accessibility decisions

**Validation & Error Handling**
- Custom date validation with ISO 8601 support requires comprehensive edge case testing
- Schema validation with Zod accelerates API development

**TypeScript Patterns**
- Extend interfaces with `Partial<Base>` instead of duplicating fields

### What Doesn't Work

**eslint-disable for Dependency Arrays**
- Suppressing `react-hooks/exhaustive-deps` with empty deps while using props leads to stale closures
- The "run only on mount" pattern is wrong when props are involved

**Field Duplication**
- Duplicating interface fields instead of extending with `Partial<Base>` creates maintenance burden

## Hot Spots (Frequently Modified Files)

| File | Touch Count | Common Reason |
|------|-------------|---------------|
| `app/components/migration/CleanupPanel.tsx` | 3 | Cleanup feature evolution, race condition fixes, persistence |
| `lib/migration/cleanup/types.ts` | 3 | Filter integration, persistence schema, type fixes |
| `lib/migration/cleanup/service.ts` | 3 | Filter support, validation, executor integration |
| `app/hooks/useCleanup.ts` | 2 | Persistence, race condition fixes |
| `lib/migration/items/filter-converter.ts` | 1 | Initial implementation |
| `lib/migration/items/filter-validator.ts` | 1 | Initial implementation |
| `lib/ai/schemas/migration.ts` | 1 | Filter schema additions |
| `lib/ai/tools.ts` | 1 | Filter parameter additions |
| `lib/migration/items/service.ts` | 1 | Filter integration |
| `lib/migration/items/types.ts` | 1 | Filter types |
| `lib/migration/cleanup/executor.ts` | 1 | Filter persistence |
| `app/api/migration/cleanup/route.ts` | 1 | Filter API integration |
| `app/components/migration/DuplicateGroupsPreview.tsx` | 1 | Master checkbox tri-state implementation |

*Files touched 3+ times indicate high complexity or rapid feature evolution (cleanup system).*

## Keyword Clusters

| Cluster | Keywords | Sessions |
|---------|----------|----------|
| **Cleanup System** | cleanup, duplicate, job-history, persistence, localStorage, TTL | 3 |
| **Filter Infrastructure** | filter, validation, date, schema, zod, api | 2 |
| **React Hooks** | useEffect, useMemo, useRef, AbortController, race-condition, dependency-array, stale-closure | 2 |
| **Accessibility** | accessibility, aria-checked, native-checkbox, indeterminate, tri-state | 2 |
| **Multi-Agent Orchestration** | multi-agent, hive, sequential-workers, parallel-reviewers, consensus-logic | 2 |
| **Type Safety** | interface, extends, Partial, TypeScript | 1 |
| **Code Review** | code-review, gemini-code-assist, PR-review, W3C, MDN | 1 |
| **Podio API** | podio, backend, migration | 2 |
| **UI/Frontend** | ui, frontend, component, bulk-selection, checkbox | 2 |

## Session Insights (Deduplicated)

1. **Multi-agent hive with sequential workers and parallel reviewers works well for complex features** - Implementation workers focus on their layer, reviewers catch edge cases across all layers
2. **Filter conversion layer between user-friendly format and API format provides clean separation of concerns** - User sees ISO dates, API gets Podio filter keys
3. **Reusing existing infrastructure accelerates development** - ItemMigrationFilters reused for cleanup feature, MigrationContext pattern reused for cleanup state
4. **Custom validation requires comprehensive edge case testing** - ISO 8601 date formats, empty filters, malformed JSON
5. **localStorage persistence requires defensive coding** - SSR checks, error handling for quota/security, schema validation
6. **useMemo is better than useEffect for derived state** - Pagination, tri-state logic - no async, just compute
7. **Async useEffect needs AbortController + isMounted guard** - Prevents race conditions on mount/unmount
8. **Props in effect body must be in deps array** - Stale closures are the enemy, never suppress eslint
9. **Extend interfaces with Partial<Base> instead of duplicating fields** - Single source of truth
10. **Session guidelines codification upfront prevents implementation issues** - Strong guidelines + sequential workers + testing = zero reviewer issues
11. **Multi-agent verification with tie-breaker consensus works for nuanced questions** - 4 models vote, Claude orchestrator resolves 2-2 ties with research
12. **aria-checked is wrong for native checkboxes** - Native elements expose state automatically, adding ARIA creates inconsistencies
13. **Web standards research essential for accessibility decisions** - W3C/MDN authoritative sources resolve conflicting AI opinions
14. **Code review bots catch valid issues** - gemini-code-assist found race conditions and type duplication
15. **Following existing patterns in same file accelerates fixes** - If one effect uses AbortController, all should

## Model Performance Notes

- **Claude Opus**: Excellent orchestrator for multi-agent workflows, tie-breaker decisions, web standards research
- **OpenCode BigPickle**: Deep architecture analysis, pattern recognition
- **OpenCode GLM 4.7**: Code organization, architectural patterns
- **OpenCode Grok Code**: Fast search, test coverage analysis, learnings/standards scouting
- **OpenCode MiniMax M2.1**: Multi-language search, cross-file patterns
- **Gemini Flash**: Fast UI/frontend implementation
- **Codex GPT-5.2**: Code simplification while preserving functionality

## Curated Guidelines

Based on the above patterns, future sessions should:

1. **Use multi-agent verification for accessibility and standards questions** - 4 models provide diverse perspectives, Claude orchestrator resolves ties with authoritative sources
2. **Codify session guidelines upfront for complex features** - Guidelines prevent implementation drift across sequential workers
3. **Reuse existing infrastructure before building new** - Filter system, persistence patterns, validation layers
4. **Use useMemo for derived state, useRef + useEffect for DOM-only properties** - Tri-state logic, indeterminate checkboxes
5. **Never suppress react-hooks/exhaustive-deps** - Stale closures cause bugs, fix the deps array instead
6. **Async useEffect must use AbortController + isMounted guard** - Prevents race conditions
7. **localStorage needs defensive coding** - SSR checks, error handling, schema validation
8. **Don't add ARIA to native HTML elements** - Browsers handle accessibility automatically
9. **Research web standards (W3C/MDN) for tie-breaker decisions** - Authoritative sources resolve AI disagreements
10. **Follow existing patterns in the same file** - Consistency accelerates development and review

---

*Curated from 6 sessions spanning 2026-01-20 to 2026-01-22*
