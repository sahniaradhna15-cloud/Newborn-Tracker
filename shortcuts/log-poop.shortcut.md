# Shortcut: Log a poop

> Shared setup, headers, `client_uuid` rules, and testing live in
> [`README.md`](./README.md). This file documents only what's specific to
> this Shortcut.

| | |
|---|---|
| **Siri phrase** | "Log a poop" |
| **Logs** | A dirty-only diaper (`pee: false, poop: true`) |
| **Inputs asked** | None |
| **Endpoint** | `POST {APP_URL}/api/events` |

## `event` payload

```json
{ "type": "diaper", "pee": false, "poop": true }
```

## Shortcut actions

1. **Text** → `APP_URL`
2. **Text** → `API_TOKEN`
3. Generate **`client_uuid`** (README → "The `client_uuid` step")
4. **Current Date** → **Format Date** → ISO 8601 → `occurred_at`
5. **Dictionary**:
   - `client_uuid`, `source` = `siri_shortcut`, `occurred_at`
   - `event` → Dictionary: `type` = `diaper`, `pee` = `false` (Boolean),
     `poop` = `true` (Boolean)
6. **Get Contents of URL** → `POST {APP_URL}/api/events`, the three headers
   (README → "Common request shape"), JSON body = Dictionary
7. **Get Dictionary Value** → `say`
8. **Show Notification** / **Speak Text** → `say`

## Test

```bash
curl -X POST "$APP_URL/api/events" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Requested-With: fetch" \
  -d '{"client_uuid":"'"$(uuidgen)"'","source":"siri_shortcut","occurred_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","event":{"type":"diaper","pee":false,"poop":true}}'
# → { "ok": true, "event_id": "...", "say": "Logged. N dirty diapers today." }
```

Same `client_uuid` twice → `status: duplicate`, identical `say`.

## iCloud

- Built `.shortcut` to iCloud Drive (not committed).
- iCloud share URL: `____________________`
