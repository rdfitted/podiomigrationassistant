# Project DNA - Podio Migration Agent

> Curated patterns and insights from development sessions. Last updated: 2026-01-21

## Patterns That Work

### Multi-Agent Hive Architecture
- Sequential worker pattern (backend→frontend→coherence) ensures clean layer separation (learned: 20260120-142840, 20260120-193522)
- Parallel reviewers catch edge cases that implementation workers miss (learned: 20260120-193522)
- Worker specialization by domain (Opus for backend, Gemini for UI, GLM for coherence) leverages model strengths

### Filter Infrastructure
- Reusing existing filter infrastructure (ItemMigrationFilters, convertFilters) accelerates feature development (learned: 20260120-193522)
- Filter conversion layer between user-friendly format and API format provides clean separation of concerns (learned: 20260120-142840)
- Filter persistence in job metadata enables reproducibility (learned: 20260120-193522)

### Validation & Error Handling
- Custom date validation with ISO 8601 support requires comprehensive edge case testing (learned: 20260120-142840)
- Backwards compatibility validation prevents breaking existing API consumers (learned: 20260120-193522)
- localStorage operations need QuotaExceededError and SecurityError handling (learned: 20260121-145015)
- Schema validation for JSON parsing prevents crashes from corrupted storage (learned: 20260121-145015)

### State Persistence & Recovery
- localStorage persistence requires SSR safety with `typeof window` checks (learned: 20260121-145015)
- TTL-based expiration (24 hours) prevents stale data accumulation (learned: 20260121-145015)
- Auto-reconnect logic needs AbortController to prevent race conditions on component mount (learned: 20260121-145015)
- useMemo is better than useEffect for derived state like pagination (learned: 20260121-145015)

## Patterns That Failed

*No failed patterns recorded yet*

## Model Performance Notes

- **Opus**: Excellent for backend/architecture work and resolving complex review findings
- **Gemini Flash**: Fast and capable for UI/frontend implementation
- **GLM**: Good for coherence verification between layers
- **BigPickle/Grok**: Effective parallel reviewers - catch complementary issues

## Key Files & Patterns

### Filter System
| File | Purpose |
|------|---------|
| `lib/migration/items/filter-converter.ts` | Converts user-friendly filters to Podio API format |
| `lib/migration/items/filter-validator.ts` | Validates filter inputs before API calls |
| `lib/migration/items/types.ts` | `ItemMigrationFilters` interface - reusable across features |

### Cleanup Feature
| File | Purpose |
|------|---------|
| `lib/migration/cleanup/types.ts` | Cleanup request/response types |
| `lib/migration/cleanup/service.ts` | Duplicate detection with filter support |
| `lib/migration/cleanup/executor.ts` | Orchestrates cleanup workflow |
| `app/hooks/useCleanup.ts` | Cleanup state management with localStorage persistence |
| `app/components/migration/CleanupPanel.tsx` | Cleanup UI with job history panel |

## Review Findings Categories

Common issues caught by reviewers:
1. **Missing validation** - Date formats, empty filters, edge cases
2. **State handling bugs** - UI state not properly reset
3. **Backwards compatibility** - API changes breaking existing clients
4. **Performance** - Early returns for common cases (no filters)
5. **Reproducibility** - Storing config in job metadata

## Sessions Curated

| Session | Task | Outcome |
|---------|------|---------|
| 20260120-142840 | Add creation date filtering to item migrations | Success |
| 20260120-193522 | Add source filters to duplicate cleanup | Success |
| 20260121-145015 | Persist cleanup job state across page refresh | Success |
