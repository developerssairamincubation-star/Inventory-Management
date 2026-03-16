# API Design Standards

This project uses Next.js App Router handlers under `src/app/api/**/route.ts`.

## Directory Structure

```text
src/
  app/
    api/
      <resource>/
        route.ts                # collection: GET(list), POST(create)
        [id]/
          route.ts              # entity: GET(one), PUT/PATCH(update), DELETE(remove)
          <action>/
            route.ts            # explicit domain action (e.g. update-stock, damage, lost)
      README.md
  lib/
    api/
      errors.ts                 # typed API/domain errors
      request.ts                # JSON parsing + query normalization
      response.ts               # HTTP response builders + error mapping
```

## Best-Practice Rules

1. Use nouns for resources (`/api/products`, `/api/lending`) and avoid verbs in base routes.
2. Keep custom operations explicit under sub-routes (`/api/products/{id}/update-stock`).
3. Return correct HTTP statuses:
   - `200` read/update success
   - `201` create success
   - `204` delete success (no body) when appropriate
   - `400` validation or malformed JSON
   - `404` missing resource
   - `409` conflict
   - `500` unexpected server error
4. Use one error shape across all routes:

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_ERROR",
    "message": "human readable message"
  }
}
```

5. Keep success payloads backward-compatible while migrating route-by-route.
6. Centralize parsing/validation logic in `src/lib/api/request.ts` and reuse it.
7. Throw typed domain errors (`ApiError`) and map them at route boundaries.
8. Keep handlers thin; move complex query/transform logic into dedicated service modules over time.

## Migration Plan for Existing Routes

1. Standardize errors first (no frontend breakage).
2. Introduce shared validation utilities.
3. Refactor heavy routes (`lending`, `products/[id]`) into service functions.
4. Add pagination/filter contracts for list routes.
5. Add API contract tests for the highest-traffic endpoints.
