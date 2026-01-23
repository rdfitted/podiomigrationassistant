# Project DNA - Podio Migration Agent

*Last curated: 2026-01-22*
*Based on: 7 session learnings*

## Core Patterns

### What Works

#### Multi-Agent Workflows
- Sequential worker pattern (implementation → coherence → simplification) ensures clean layer separation - Used in 4 sessions
- Parallel reviewers catch complementary issues (8 issues caught in issue-37 session)
- Session guidelines codification upfront prevents implementation issues - Zero reviewer issues when done right (issue-49)
- Multi-agent verification (4 OpenCode models) with tie-breaker consensus works for nuanced decisions (PR-50)
- Sequential layered workers (Opus → Gemini → GLM → Codex) execute cleanly with shared guidelines

#### Filter Infrastructure (issue-34, issue-37)
- Reusing existing filter infrastructure (ItemMigrationFilters, convertFilters) accelerates feature development
- Filter conversion layer (user-friendly → API format) provides clean separation of concerns
- Filter persistence in job metadata enables reproducibility
- Custom date validation with ISO 8601 support requires comprehensive edge case testing

#### React Hooks Best Practices (issue-45, fix-comment, issue-49)
- `useMemo` for derived state (tri-state logic, pagination) - better than `useEffect`
- `useRef` + `useEffect` for DOM-only properties (`indeterminate`)
- Async `useEffect` needs `AbortController` + `isMounted` guard to prevent race conditions
- Include all props used in an effect in the dependency array - never suppress ESLint
- Follow existing patterns in same file for consistency

#### State Persistence (issue-45)
- `localStorage` requires SSR safety (`typeof window` check) and `QuotaExceededError`/`SecurityError` handling
- Schema validation for JSON parsing prevents crashes from corrupted storage
- TTL-based expiration prevents stale data accumulation
- Auto-reconnect logic needs `AbortController` to prevent mount race conditions

#### Accessibility Standards (PR-50)
- `aria-checked` should NOT be added to native HTML checkboxes - only for ARIA `role="checkbox"`
- Native checkboxes expose `indeterminate` state automatically to assistive tech
- Don't override native semantic state with ARIA attributes (`aria-checked`, `aria-selected`) - they duplicate native semantics
- Valid ARIA usage (`aria-label`, `aria-describedby`) is allowed for supplementary info
- Web standards research (W3C/MDN) essential for accessibility decisions

#### Code Review
- Code review bots (gemini-code-assist, CodeRabbit) catch valid race condition, accessibility, and documentation issues
- Multi-agent verification validates or refutes bot comments with research
- Markdown documentation should use proper heading syntax (`####`) for semantic structure, not bold emphasis - aligns with project standards (README.md, bug-patterns.md)

#### Validation & Error Handling
- Schema validation with Zod accelerates API development

#### TypeScript Patterns (fix-comment)
- Extend interfaces with `Partial<Base>` instead of duplicating fields

### What Doesn't Work

#### `eslint-disable` for Dependency Arrays
- Suppressing `react-hooks/exhaustive-deps` with empty deps while using props leads to stale closures
- The "run only on mount" pattern is wrong when props are involved

#### Field Duplication
- Duplicating interface fields instead of extending with `Partial<Base>` creates maintenance burden

#### Overly Broad ARIA Guidelines
- Blanket rule "Don't add ARIA to native HTML elements" is too broad - valid uses (`aria-label`, `aria-describedby`) exist
- Better: "Don't override native semantic state with ARIA" (more specific and actionable)

## Hot Spots (Frequently Modified Files)

| File | Touch Count | Sessions | Common Reason |
|------|-------------|----------|---------------|
| `app/components/migration/CleanupPanel.tsx` | 3 | issue-37, issue-45, fix-comment | Cleanup feature evolution, race condition fixes, persistence |
| `lib/migration/cleanup/types.ts` | 3 | issue-37, issue-45, fix-comment | Filter integration, persistence schema, type fixes |
| `lib/migration/cleanup/service.ts` | 3 | issue-37, issue-45, fix-comment | Filter support, validation, executor integration |
| `app/hooks/useCleanup.ts` | 2 | issue-45, fix-comment | Persistence, race condition fixes |
| `lib/migration/items/filter-converter.ts` | 1 | issue-34 | Initial implementation |
| `lib/migration/items/filter-validator.ts` | 1 | issue-34 | Initial implementation |
| `lib/ai/schemas/migration.ts` | 1 | issue-34 | Filter schema additions |
| `lib/ai/tools.ts` | 1 | issue-34 | Filter parameter additions |
| `lib/migration/items/service.ts` | 1 | issue-34 | Filter integration |
| `lib/migration/items/types.ts` | 1 | issue-34 | Filter types |
| `lib/migration/cleanup/executor.ts` | 1 | issue-37 | Filter persistence |
| `app/api/migration/cleanup/route.ts` | 1 | issue-37 | Filter API integration |
| `app/components/migration/DuplicateGroupsPreview.tsx` | 1 | issue-49 | Master checkbox tri-state implementation |
| `.ai-docs/project-dna.md` | 2 | PR-50 (2 fixes) | ARIA guideline refinement, MD036 heading syntax fixes |

*Files touched 3+ times indicate high complexity or rapid feature evolution, especially in the cleanup system.*

## Keyword Clusters

| Cluster | Keywords | Sessions |
|---------|----------|----------|
| **Cleanup System** | cleanup, duplicate, job-history, persistence, localStorage, TTL, pagination | 3 |
| **Filter Infrastructure** | filter, validation, date, schema, zod, api, podio | 3 |
| **React Hooks** | useEffect, useMemo, useRef, AbortController, race-condition, dependency-array, stale-closure | 3 |
| **Accessibility** | accessibility, aria-checked, native-checkbox, indeterminate, tri-state, ARIA, native-elements, W3C, MDN | 3 |
| **Multi-Agent Orchestration** | multi-agent, hive, sequential-workers, parallel-reviewers, consensus-logic, multi-agent-verification | 4 |
| **Type Safety** | interface, extends, Partial, TypeScript | 1 |
| **Code Review** | code-review, gemini-code-assist, PR-review, CodeRabbit | 2 |
| **Podio API** | podio, backend, migration | 3 |
| **UI/Frontend** | ui, frontend, component, bulk-selection, checkbox | 3 |
| **Documentation** | project-dna, documentation, markdownlint, markdown-headings | 2 |

## Session Insights (Deduplicated)

1. **Multi-agent hive with sequential workers and parallel reviewers works well for complex features** - Implementation workers focus on their layer, reviewers catch edge cases across all layers (issue-34, issue-37)
2. **Filter conversion layer between user-friendly format and API format provides clean separation of concerns** - User sees ISO dates, API gets Podio filter keys (issue-34)
3. **Reusing existing infrastructure accelerates development** - ItemMigrationFilters reused for cleanup feature, MigrationContext pattern reused for cleanup state (issue-37, issue-45)
4. **Custom validation requires comprehensive edge case testing** - ISO 8601 date formats, empty filters, malformed JSON (issue-34, issue-37)
5. **`localStorage` persistence requires defensive coding** - SSR checks, error handling for quota/security, schema validation (issue-45)
6. **`useMemo` is better than `useEffect` for derived state** - Pagination, tri-state logic - no async, just compute (issue-45, issue-49)
7. **Async `useEffect` needs `AbortController` + `isMounted` guard** - Prevents race conditions on mount/unmount (issue-45, fix-comment)
8. **Props in effect body must be in deps array** - Stale closures are the enemy, never suppress ESLint (fix-comment)
9. **Extend interfaces with `Partial<Base>` instead of duplicating fields** - Single source of truth (fix-comment)
10. **Session guidelines codification upfront prevents implementation issues** - Strong guidelines + sequential workers + testing = zero reviewer issues (issue-49)
11. **Multi-agent verification with tie-breaker consensus works for nuanced questions** - 4 models vote, Claude orchestrator resolves 2-2 ties with research (PR-50)
12. **`aria-checked` is wrong for native checkboxes** - Native elements expose state automatically, adding ARIA creates inconsistencies (PR-50)
13. **Web standards research essential for accessibility decisions** - W3C/MDN authoritative sources resolve conflicting AI opinions (PR-50)
14. **Code review bots catch valid issues** - gemini-code-assist and CodeRabbit found race conditions, type duplication, and overly broad guidelines (fix-comment, PR-50)
15. **Following existing patterns in the same file accelerates fixes** - If one effect uses `AbortController`, all should (fix-comment)
16. **Sequential layered workers execute cleanly with shared guidelines** - Opus → Gemini → GLM → Codex pattern with upfront session guidelines (issue-49)
17. **Tester phase catches edge cases missed by code reviewers** - Empty groups visibility issue found during testing (issue-49)
18. **ARIA guidelines need specificity over breadth** - "Don't override native semantic state" is better than "Don't add ARIA to native elements" (PR-50)
19. **Markdown documentation should use proper heading syntax** - Converting `**Section Name**` to `#### Section Name` provides semantic structure and aligns with project standards (PR-50)

## Model Performance Notes

- **Claude Opus**: Excellent orchestrator for multi-agent workflows, tie-breaker decisions, web standards research
- **OpenCode BigPickle**: Deep architecture analysis, pattern recognition, accessibility research
- **OpenCode GLM 4.7**: Code organization, architectural patterns
- **OpenCode Grok Code**: Fast search, test coverage analysis, learnings/standards scouting
- **OpenCode MiniMax M2.1**: Multi-language search, cross-file patterns
- **Gemini Flash**: Fast UI/frontend implementation
- **Codex GPT-5.2**: Code simplification while preserving functionality, wording clarity

## Curated Guidelines

Based on the above patterns, future sessions should:

1. **Use multi-agent verification for accessibility and standards questions** - 4 models provide diverse perspectives, Claude orchestrator resolves ties with authoritative sources (W3C/MDN)
2. **Codify session guidelines upfront for complex features** - Guidelines prevent implementation drift across sequential workers
3. **Reuse existing infrastructure before building new** - Filter system, persistence patterns, validation layers
4. **Use `useMemo` for derived state, `useRef` + `useEffect` for DOM-only properties** - Tri-state logic, indeterminate checkboxes
5. **Never suppress `react-hooks/exhaustive-deps`** - Stale closures cause bugs, fix the deps array instead
6. **Async `useEffect` must use `AbortController` + `isMounted` guard** - Prevents race conditions
7. **`localStorage` needs defensive coding** - SSR checks, error handling, schema validation
8. **Don't override native semantic state with ARIA** - Native checkboxes/radios/buttons expose state automatically; only use ARIA for custom widgets or supplementary info (`aria-label`, `aria-describedby`)
9. **Research web standards (W3C/MDN) for tie-breaker decisions** - Authoritative sources resolve AI disagreements
10. **Follow existing patterns in the same file** - Consistency accelerates development and review
11. **Include tester phase in complex features** - Catches edge cases missed by code reviewers
12. **Sequential layered workers (Opus → Gemini → GLM → Codex) work well with shared guidelines** - Each layer focuses on its strength
13. **Trust but verify code review bots** - gemini-code-assist and CodeRabbit find valid issues, but verify with multi-agent research when conflicting
14. **Use proper markdown heading syntax in documentation** - Headings should use `#`/`##`/`###`/`####` syntax rather than bold emphasis for semantic structure and consistency

---

*Curated from 7 sessions spanning 2026-01-20 to 2026-01-22*
