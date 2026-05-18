# Shortcut: Log nursing

> Shared setup, headers, `client_uuid` rules, and testing live in
> [`README.md`](./README.md). This file documents only what's specific to
> this Shortcut.

| | |
|---|---|
| **Siri phrase** | "Log nursing" |
| **Logs** | A nursing session (`kind: nursing`) — side + duration |
| **Inputs asked** | Side (left / right / both); duration in minutes |
| **Endpoint** | `POST {APP_URL}/api/events` |

Nursing is the one feed type with **no volume** — the server derives
`estimated_oz` from `duration_min` via the nursing-rate estimator
(`targets.ts`, Phase 1). So this Shortcut must send `side` + `duration_min`,
**not** `volume_oz`.

## `event` payload

```json
{ "type": "feed", "kind": "nursing", "side": "left | right | both", "duration_min": <number> }
```

`side` must be exactly one of `left`, `right`, `both` (lowercase — the Zod
enum is case-sensitive).

## Shortcut actions

1. **Text** → `APP_URL`
2. **Text** → `API_TOKEN`
3. **Choose from Menu** → "Which side?" → items **Left**, **Right**, **Both**.
   In each branch set a `side` variable to the lowercase string
   (`left` / `right` / `both`) — do not pass the menu label directly (it's
   capitalized; the enum is not).
4. **Ask for Input** → "How many minutes?" → Type **Number** → `duration_min`
5. Generate **`client_uuid`** (README → "The `client_uuid` step")
6. **Current Date** → **Format Date** → ISO 8601 → `occurred_at`
7. **Dictionary**:
   - `client_uuid`, `source` = `siri_shortcut`, `occurred_at`
   - `event` → Dictionary: `type` = `feed`, `kind` = `nursing`,
     `side` = (step 3), `duration_min` = (step 4, **Number**)
8. **Get Contents of URL** → `POST {APP_URL}/api/events`, the three headers,
   JSON body = Dictionary
9. **Get Dictionary Value** → `say`
10. **Show Notification** / **Speak Text** → `say`

## Test

```bash
curl -X POST "$APP_URL/api/events" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Requested-With: fetch" \
  -d '{"client_uuid":"'"$(uuidgen)"'","source":"siri_shortcut","occurred_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","event":{"type":"feed","kind":"nursing","side":"both","duration_min":15}}'
# → { "ok": true, "event_id": "...", "say": "Logged 15 min nursing (~N oz). M oz today, target P–Q oz." }
```

`duration_min` is a JSON **number**. `side` lowercase. Same `client_uuid`
twice → `status: duplicate`, identical `say`.

## iCloud

- Built `.shortcut` to iCloud Drive (not committed).
- iCloud share URL: `____________________`
