# Shortcut: Log formula

> Shared setup, headers, `client_uuid` rules, and testing live in
> [`README.md`](./README.md). This file documents only what's specific to
> this Shortcut.

| | |
|---|---|
| **Siri phrase** | "Log formula" |
| **Logs** | A formula feed with a volume (`kind: formula`) |
| **Inputs asked** | Volume in oz (required); wasted oz (optional) |
| **Endpoint** | `POST {APP_URL}/api/events` |

## `event` payload

```json
{ "type": "feed", "kind": "formula", "volume_oz": <number>, "wasted_oz": <number, optional> }
```

`wasted_oz` is optional per the `InboundEvent` contract — **omit the key
entirely** if the user doesn't provide it (don't send `0` unless they said 0;
`estimated_oz` is computed server-side from `volume_oz`).

## Shortcut actions

1. **Text** → `APP_URL`
2. **Text** → `API_TOKEN`
3. **Ask for Input** → "How many ounces?" → Type **Number** → `volume_oz`
4. *(Optional)* **Ask for Input** → "Wasted ounces? (leave blank for none)" →
   Type **Number**, Allow blank → `wasted_oz`. Use an **If** (input has value)
   to decide whether to add the `wasted_oz` key in step 7.
5. Generate **`client_uuid`** (README → "The `client_uuid` step")
6. **Current Date** → **Format Date** → ISO 8601 → `occurred_at`
7. **Dictionary**:
   - `client_uuid`, `source` = `siri_shortcut`, `occurred_at`
   - `event` → Dictionary: `type` = `feed`, `kind` = `formula`,
     `volume_oz` = (step 3, **Number**), and `wasted_oz` (step 4, Number)
     **only inside the If-has-value branch**
8. **Get Contents of URL** → `POST {APP_URL}/api/events`, the three headers,
   JSON body = Dictionary
9. **Get Dictionary Value** → `say`
10. **Show Notification** / **Speak Text** → `say`

## Test

```bash
curl -X POST "$APP_URL/api/events" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Requested-With: fetch" \
  -d '{"client_uuid":"'"$(uuidgen)"'","source":"siri_shortcut","occurred_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","event":{"type":"feed","kind":"formula","volume_oz":3}}'
# → { "ok": true, "event_id": "...", "say": "Logged 3 oz formula. N oz today, target M–P oz." }
```

Send `volume_oz` as a JSON **number**, not a string. Same `client_uuid` twice
→ `status: duplicate`, identical `say`.

## iCloud

- Built `.shortcut` to iCloud Drive (not committed).
- iCloud share URL: `____________________`
