# Shortcut: Log baby (one shortcut, hands-free)

> The recommended setup. **One** Shortcut replaces all six below — you say
> "Hey Siri, Log baby", then speak what happened in plain words. The server
> parses the phrase (`src/lib/spoken-log-parser.ts`), so the Shortcut itself
> has no menus, no dictionaries per event type, and **no `client_uuid`
> step** (the `/api/voice` endpoint generates one server-side).
>
> Shared token setup lives in [`README.md`](./README.md). The six
> per-phrase Shortcuts are still documented there if you ever want
> dedicated voice phrases instead of one spoken one.

| | |
|---|---|
| **Siri phrase** | "Log baby" (rename the Shortcut to set this) |
| **Logs** | Whatever you say: pee / poop / dirty diaper / formula / pumped / nursing |
| **Inputs asked** | One spoken phrase |
| **Endpoint** | `POST {APP_URL}/api/voice` |

## What you can say

| You say | What it logs |
|---|---|
| "poop" / "dirty diaper" | a dirty diaper |
| "pee" / "wet diaper" | a wet diaper |
| "wet and dirty" / "pee and poop" | both |
| "two ounces of formula" | 2 oz formula |
| "pumped three ounces" / "three ounces of breast milk" | 3 oz pumped |
| "nursed fifteen minutes on the left" | 15 min nursing, left |
| "nursed ten minutes" | 10 min nursing, both sides (side defaults to both) |

If the phrase is incomplete, Siri reads back a question instead of failing
silently — e.g. "How many ounces?", "Was that wet, dirty, or both?". Just
run it again with the missing detail.

## Request shape

```json
POST {APP_URL}/api/voice
{ "text": "two ounces of formula" }
```

`source`, `client_uuid`, and `occurred_at` are all filled in server-side.

## Shortcut actions

1. **Text** → `APP_URL` (your stable app URL — see README "One-time setup")
2. **Text** → `API_TOKEN` (from Settings → Voice tokens, shown once)
3. **Dictate Text** → prompt "What happened?" → result is `Dictated Text`
4. **Dictionary**: one key, `text` = `Dictated Text`
5. **Get Contents of URL** → `POST {APP_URL}/api/voice`
   - Headers: `Authorization` = `Bearer {API_TOKEN}`, `Content-Type` =
     `application/json`, `X-Requested-With` = `fetch`
   - Request Body: **JSON** = the Dictionary from step 4
6. **Get Dictionary Value** → `say` (from the response)
7. **Speak Text** → `say`

That's it — seven actions, no UUID juggling.

## Test

```bash
curl -X POST "$APP_URL/api/voice" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Requested-With: fetch" \
  -d '{"text":"two ounces of formula"}'
# → { "ok": true, "event_id": "...", "say": "Logged 2 oz of formula. ..." }

curl -X POST "$APP_URL/api/voice" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Requested-With: fetch" \
  -d '{"text":"diaper"}'
# → { "ok": false, "error": "unparsed_speech", "say": "Was that wet, dirty, or both?" }
```

## iCloud

- Built `.shortcut` to iCloud Drive (not committed).
- iCloud share URL: `____________________`
