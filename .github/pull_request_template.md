## What this adds

<!-- One or two sentences. Which section of docs/endpoints.md does it complete? -->

## How it was tested

<!-- Paste the output of `uv run pytest -q` and one real call to the endpoint with its response. -->

## Checklist

- [ ] Branch is `feat/<role>-<topic>`, rebased on `main`; one functionality only
- [ ] Logic in `app/logic` (no file or network access); data access in `app/db`; router has no formulas
- [ ] Schemas in snake_case with units in the descriptions; times in UTC
- [ ] Tests: happy path, 422, 404 and a numerical case; the whole suite passes
- [ ] Unknown data is returned as unknown; thresholds and defaults have a source
- [ ] `docs/endpoints.md` status updated; new sources added to `docs/references.md`
- [ ] `CLAUDE.md` changed only by adding a row to "Implemented endpoints and filters" (finished work only)
- [ ] Shared files touched (list them): <!-- main.py, services.py, logic/engine.py, db/store.py -->

## Reviewer

<!-- Another team member reviews and approves before merging. Do not merge your own pull request. -->
