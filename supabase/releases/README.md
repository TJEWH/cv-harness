# Current schema fingerprints

`current.json` records SHA-256 fingerprints for the current atomic installer, ordered SQL modules, canonical opportunity contract and runner source files. Regenerate it with `npm run adaptive:release:write` after reviewing changes; check it with `npm run adaptive:release:check`.

This is a reproducibility check for current source. It contains no historical bootstrap, upgrade sequence, production data or deployment authorization. Deployed migration history remains in Supabase; earlier repository definitions remain in Git.

`adaptive-search-lifecycle-v1.sql` is a separately reviewed, one-time targeted upgrade for lifecycle contract 1, with its repository baseline recorded in the file. It is not run by the application or by schema generation. Review [deployment and safe rollback](../../docs/adaptive-search-lifecycle.md) before any separately authorized installation. Current source fingerprints include this artifact and its closed lifecycle schemas.

`verification.json` records the completed current-schema consolidation and frozen-snapshot conversion checks. It contains aggregate counts and preservation results only. The one-time conversion SQL is retained in deployed migration history, with its reviewed hash in this report; it is not a supported installer or runtime conversion path.
