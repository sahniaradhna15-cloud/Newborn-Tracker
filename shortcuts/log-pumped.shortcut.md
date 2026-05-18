# Shortcut: Log pumped milk

> Shared setup, headers, `client_uuid` rules, and testing live in
> [`README.md`](./README.md). This file documents only what's specific to
> this Shortcut.

| | |
|---|---|
| **Siri phrase** | "Log pumped milk" |
| **Logs** | A bottle of expressed breast milk (`kind: pumped`) |
| **Inputs asked** | Volume in oz (required); wasted oz (optional) |
| **Endpoint** | `POST {APP_URL}/api/events` |

Same payload family as formula (`kind: pumped | formula` → `volume_oz`,
optional `wasted_oz`), only `kind` differs. Kept as a separate phrase so the
caregiver never has to disambiguate by voice.

## `event` payload

```json
{ "type": "feed", "kind": "pumped", "volume_oz": <number>, "wasted_oz": <number, optional> }
```

Omit `wasted_oz` entirely when not supplied.

## Shortcut actions

1. **Text** → `APP_URL`
2. **Text** → `API_TOKEN`
3. **Ask for Input** → "How many ounces?" → Type **Number** → `volume_oz`
4. *(Optional)* **Ask for Input** → "Wasted ounces? (blank for none)" →
   Number, allow blank → guard with **If has value** before adding the key
5. Generate **`client_uuid`** (README → "The `client_uuid` step")
6. **Current Date** → **Format Date** → ISO 8601 → `occurred_at`
7. **Dictionary**:
   - `client_uuid`, `source` = `siri_shortcut`, `occurred_at`
   - `event` → Dictionary: `type` = `feed`, `kind` = `pumped`,
     `volume_oz` = (step 3, **Number**), `wasted_oz` only in the
     If-has-value branch
8. **Get Contents of URL** → `POST {APP_URL}/api/events`, the three headers,
   JSON body = Dictionary
9. **Get Dictionary Value** → `say`
10. **Show Notification** / **Speak Text** → `say`

## Test

```bash
curl -X POST "$APP_URL/api/events" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Requested-With: fetch" \
  -d '{"client_uuid":"'"$(uuidgen)"'","source":"siri_shortcut","occurred_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","event":{"type":"feed","kind":"pumped","volume_oz":4}}'
# → { "ok": true, "event_id": "...", "say": "Logged 4 oz pumped. N oz today, target M–P oz." }
```

Same `client_uuid` twice → `status: duplicate`, identical `say`.

## iCloud

- Built `.shortcut` to iCloud Drive (not committed).
- iCloud share URL: `____________________`
