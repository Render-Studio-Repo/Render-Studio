# Update receipt plan

This repo now has a lightweight **fleet update receipt** source of record:

- Supabase migration: `supabase/migrations/002_fleet_receipts_sor.sql`
- Local writer: `tools/receipts/update-receipt.js`
- Sandbox receipt folder: `sandbox-sessions/receipts/`

## Receipt flow

1. A worker or harness run produces a structured receipt payload.
2. Save that payload locally with:

   ```bash
   node tools/receipts/update-receipt.js --input sandbox-sessions/receipts/examples/RCPT-WORKSHOP-20260918-god-view.json
   ```

3. The writer materializes:
   - `sandbox-sessions/receipts/<receipt_id>.json`
   - `sandbox-sessions/receipts/latest.json`
4. Upsert the same payload to Supabase table `fleet_update_receipts` on `receipt_id`.
5. If the run found a product issue first, log `fleet_failures` and link the receipt with `failure_id`.
6. Once the fix is verified, add a `fleet_fix_receipts` row that points back at the receipt and/or PR URL.

## Supabase upsert shape

Minimal JS sketch:

```js
await supabase
  .from("fleet_update_receipts")
  .upsert({
    receipt_id: payload.receipt_id,
    log_id: payload.log_id,
    pr_url: payload.pr_url,
    pr_number: payload.pr_number,
    color: payload.color,
    guard_note: payload.guard_note,
    mule_hop: payload.mule_hop,
    rmq: payload.rmq,
    status: payload.status,
    failure_id: payload.failure_id ?? null,
    payload: payload.payload ?? {},
  }, { onConflict: "receipt_id" });
```

## Guard contract

- Harness guard returns exactly one color: `green`, `yellow`, or `red`.
- The guard **never merges** code or changes PR state by itself.
- Guard output should update the receipt `color`, `guard_note`, and `status`.
- Wake format for the harness:

  ```text
  HARNESS_WAKE UPDATE_RECEIPT
  receipt_id=<RCPT-...>
  pr_url=<https://github.com/.../pull/...>
  ```

## Merge sequencing

When multiple prerequisite PRs exist, the intended order is:

1. `#11`
2. `#9`
3. feature PRs such as Workshop follow-on work

The receipt should call out dependency or supersession notes in `payload.dependencies` / `payload.supersession_note`.
