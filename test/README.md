# Tests

Tests are grouped by the runtime they need, then by the product area they cover.

| Directory | Purpose |
| --- | --- |
| `unit/` | Isolated domain, layout, storage, protocol and platform contracts |
| `integration/` | Vue components, editor workflows, document pipelines and repository boundaries |
| `database/` | Current PostgreSQL contracts installed from `supabase/schema.sql` |
| `protocol/refinement/` | Offline prompt/trace checks, generated synthetic tasks and the explicitly invoked live runner |
| `browser/pages/` | Synthetic development pages using production components |
| `browser/flows/` | Refinement and attachment HTML acceptance flows |
| `browser/specs/` | Automated Playwright interaction checks |
| `support/` | Shared Vue compilation/renderer, database transport, fixtures and workflow harnesses |
| `types/` | Compile-time contracts checked by `npm run typecheck` |

## Offline checks

Use Node 22+ and the installed project dependencies.

```sh
npm test
npm run test:unit
npm run test:integration
npm run test:refinement
npm run test:refinement-protocol
npm run build
```

`npm test` recursively discovers sorted `*.test.ts` files under `unit`, `integration` and `protocol`. It uses four workers by default; `CV_TEST_CONCURRENCY=2 npm test` changes that bound. `npm test -- --list` shows the selected files without running them. Database, browser and live-agent runners are separate commands.

Tests compile actual Vue SFCs through `support/vue/compileSfc.ts` where a setup-only or inline-template harness is sufficient. Each caller keeps its explicit mocks. Source-scoped CommonJS loading preserves the editing/textarea registry used by the component. Interaction tree hosts, separately compiled templates, brush fixtures and WebGL hosts keep their specialized implementations. `stubRenderer.ts` is for setup/lifecycle tests with no DOM assertions.

Check generated/current contracts after changing their sources:

```sh
npm run db:schema:check
npm run adaptive:release:check
npm run refinement:prompts:check
node scripts/generateOpportunityTypes.mjs --check
```

See [refinement prompt checks](protocol/refinement/README.md) and [workflow coverage](protocol/refinement/TESTING.md). The live runner requires explicit setup and remains outside `npm test`.

## Database checks

```sh
npm run test:database
```

The 100 current tests exercise all 42 SQL assertion files against a fresh atomic installation. Suites run serially through `support/database/postgres.ts`. The helper uses only the fixed, labelled `cv-adaptive-feedback-test` container and `adaptive_feedback_test` database. It checks that the container has no network, bind mounts or published ports, and takes a process lock before resetting schemas. Fixture files are read from repository-root-relative paths.

Create the disposable fixture once:

```sh
docker run -d --name cv-adaptive-feedback-test --network none \
  --label cv-builder.test-suite=adaptive-feedback \
  -e POSTGRES_PASSWORD=synthetic-fixture-only \
  -e POSTGRES_DB=adaptive_feedback_test postgres:17.6
docker exec cv-adaptive-feedback-test sh -c '[ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres -d adaptive_feedback_test'
```

Run the readiness command again until it succeeds. Remove the fixture with `docker rm -f cv-adaptive-feedback-test` when finished. These tests use synthetic owners and JWT claims. See the [database guide](../supabase/README.md) for the current schema and installation checks.

## Browser checks

An installed Playwright runtime and Chromium are prerequisites. Set `PLAYWRIGHT_MODULE_PATH` to the runtime's module or package directory when it is outside this project. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when using an existing browser executable.

```sh
npm run test:browser
```

The runner owns the isolated Vite server and its cleanup. It executes all five interaction drivers, then the 13 refinement flows and seven attachment checks at desktop and phone widths. It fails on runtime errors or external requests. The Vite configuration disables cloud configuration and `.env` loading and binds to loopback.

For focused checks against an already started synthetic server:

```sh
npm run test:e2e:serve
node test/browser/run.mjs --reuse-server --drivers-only
node test/browser/run.mjs --reuse-server --html-only
```

The browser pages can also be opened manually under `http://127.0.0.1:5177/cv-harness/test/browser/pages/`. Starting Vite alone does not execute their assertions. Additional CV Studio, PDF, layout and visualization pages remain manual fixtures; see [workflow coverage](protocol/refinement/TESTING.md) for their boundaries.

## CI

The reusable `Tests` workflow runs offline checks, current schema/release/type/prompt checks and a build. A separate job creates the labelled PostgreSQL fixture, runs current database tests serially, and always removes it. Pull requests run this workflow directly; Pages deployment calls it as `validate`, and its build waits for both jobs. Browser checks use the explicit installed-runtime command above. CI requires no real database credentials.
