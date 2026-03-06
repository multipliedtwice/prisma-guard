# Review Notes

Known false positives and design decisions documented here to avoid re-flagging in future reviews.

## False positives (do not flag)

### "Code injection via emitZodChains"

The generator interpolates validated chain strings into function bodies. The input is the developer's own Prisma schema file, not user input. The recursive-descent parser in `validate-directive.ts` restricts to a whitelist of Zod methods and primitive argument types. No identifiers, template literals, object literals, or arbitrary code can pass validation. This is not an attack surface.

### "No exports entry for generated output"

Generated output lives inside the consumer's project directory (like all Prisma generators) and is imported via relative path. This is standard Prisma generator behavior, not a packaging issue.

### "LRU cache in schema-builder has no invalidation"

The type map is static (generated at build time from the Prisma schema). Cache entries are deterministic for a given model+field combination. No invalidation is needed. The 500-entry limit is reasonable for any realistic schema size.

### "CJS import pattern in generator index.ts"

`import pkg from '@prisma/generator-helper'` with destructuring is the standard pattern for consuming a CJS module from an ESM context. Node.js handles this correctly.

### "guard.ts has low coverage (57%)"

The four public methods in guard.ts are one-liner delegations to `schemaBuilder`, `queryBuilder`, and `createScopeExtension`, all of which have their own dedicated test suites. The uncovered lines are the `model()` and `query()` wrappers. Adding unit tests for these would test the delegation, not the logic.

### "Nested writes bypass scope extension"

This is standard Prisma `$allOperations` behavior. The extension fires once for the top-level operation. Nested writes within `data` do not trigger separate `$allOperations` calls. This is by design and documented in the README. The two-layer approach (scope extension + query shapes) addresses this: shapes control which nested args are allowed, preventing unauthorized nested write paths. Additionally, `stripScopeRelations` deletes scope relation keys from mutation data.

### "scope-extension.ts has no aggregate/groupBy e2e tests"

The 56 e2e tests in `runtime-scope.e2e.test.ts` achieve 96%+ coverage on `scope-extension.ts`. The explicit `AGGREGATE_OPS` code path is covered. What remains uncovered in `query-builder.ts` are error branches in shape-building for aggregate fields (`_count`, `_avg`, `_sum`, `_min`, `_max`, `by`), which is a separate concern from scope enforcement.

## Acknowledged limitations (documented in README)

### findUnique TOCTOU

Post-query scope verification has an inherent race condition. Documented with recommendation to use `findFirst` if unacceptable.

### Json/Bytes fields in where/orderBy

Throws `ShapeError` at schema construction time. Documented in "Field type limitations" section.

### Scope extension applies to top-level only

Documented in "Scope applies to top-level operations only" section.

## Remaining gaps

### validate-directive.ts line 244

Defensive `chainCount === 0` check at end of parser. Unreachable through any known input because earlier checks (empty input, missing dot) always return first. Kept as a safety net.

### applyForcedTree "both include and select" error

Defensive assertion in `applyForcedTree`. Unreachable through the public API because `buildIncludeSchema` and `buildSelectSchema` both reject configs that define both `include` and `select` before the forced tree is constructed. Kept as a safety net.