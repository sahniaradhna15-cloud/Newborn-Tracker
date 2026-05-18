# Shortcut: Log a pee

> Shared setup, headers, `client_uuid` rules, and testing live in
> [`README.md`](./README.md). This file documents only what's specific to
> this Shortcut.

| | |
|---|---|
| **Siri phrase** | "Log a pee" |
| **Logs** | A wet-only diaper (`pee: true, poop: false`) |
| **Inputs asked** | None — zero-friction, one phrase |
| **Endpoint** | `POST {APP_URL}/api/events` |

## `event` payload

```json
{ "type": "diaper", "pee": true, "poop": false }
```

## Shortcut actions (build by hand in the iOS Shortcuts app)

1. **Text** → `APP_URL` (your `NEXT_PUBLIC_APP_URL`)
2. **Text** → `API_TOKEN` (raw token from Settings → Voice tokens)
3. Generate **`client_uuid`** — fresh UUID v4 per run (see README → "The
   `client_uuid` step")
4. **Current Date**
5. **Format Date** → ISO 8601, result → `occurred_at`
6. **Dictionary**:
   - `client_uuid` → (step 3)
   - `source` → `siri_shortcut`
   - `occurred_at` → (step 5)
   - `event` → Dictionary: `type` = `diaper`, `pee` = `true` (Boolean),
     `poop` = `false` (Boolean)
7. **Get Contents of URL**
   - URL: `APP_URL` + `/api/events`
   - Method: `POST`
   - Headers: `Authorization: Bearer {API_TOKEN}`,
     `Content-Type: application/json`, `X-Requested-With: fetch`
   - Request Body: **JSON** ← Dictionary from step 6
8. **Get Dictionary Value** → key `say` from the response
9. **Show Notification** (or **Speak Text**) → the `say` value

## Test

```bash
curl -X POST "$APP_URL/api/events" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Requested-With: fetch" \
  -d '{"client_uuid":"'"$(uuidgen)"'","source":"siri_shortcut","occurred_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","event":{"type":"diaper","pee":true,"poop":false}}'
# → { "ok": true, "event_id": "...", "say": "Logged. N wet diapers today." }
```

Re-run with the **same** `client_uuid` → `status: duplicate`, identical `say`,
no second row (idempotency proof).

## iCloud

- Built `.shortcut` uploaded to iCloud Drive by the user; **not** committed.
- iCloud share URL: `____________________` (paste after upload; consumed by
  `/settings/voice` import deep link)
