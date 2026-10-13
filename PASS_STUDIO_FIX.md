# Pass Studio template and provider payload fixes

Prepared against GitHub commit 9e4d246 (fix03), including the earlier private R2 and token delivery changes.

## Fixed behavior

- Immediate issuance loads `schema_definition` instead of discarding it in the race/template SQL join and call arguments.
- All six Studio presets are forwarded as the exact `colorPreset` string. No preview background hex is automatically sent as `color`, even on Pro.
- Legacy templates containing only a preview hex first match an exact known preset; approximation is a last resort.
- The Studio sample JSON, visual previews, Worker, and local provider calls use `server/walletPayload.ts` to resolve the same participant fields.
- Front-field data keys and race CSV mappings are honored. Only resolved `label`, `value`, and optional `changeMessage` go into provider field arrays; internal keys stay internal.
- Mapped back fields use the actual participant email/emergency contact instead of old sample text. Static values and mapped keys have separate inputs.
- Blank labels, empty barcode alt text, zero, false, and empty back-field arrays are preserved.
- Switching templates resets every editable field instead of retaining values from the previous template. Saving preserves image URLs, extra field entries, and field metadata.
- Template create/update validate JSON and enum values. A partial template update that omits the schema preserves the existing schema.
- Provider errors are reported without retrying a changed design on Free.
- Runner updates send the full pass specification via PUT on both supported plan settings (Free and Pro). The former `{fields, first_name, last_name}` request was not the documented API shape. Omitting dynamic data now preserves it.

## Provider fields

The implementation follows https://www.walletwallet.dev/docs/ as checked on October 13, 2026:

- `colorPreset`: dark, blue, green, red, purple, orange; available on all plans.
- `color`: explicit custom hex, paid feature; overrides the preset. Studio is a preset editor, so saving a preset removes a legacy `schema.color` override.
- `barcodeValue`, `barcodeFormat`, `barcodeAltText`, `logoText`, `description`, `organizationName`, `sharingProhibited`.
- `headerFields`, `primaryFields`, `secondaryFields`, `backFields`: arrays of `{label?, value, changeMessage?}`.
- Existing paid image columns map to `logoURL`, `stripURL`, and `backgroundURL`. They require the Pro setting and HTTPS or PNG data URIs. The current Studio UI does not add custom artwork controls.
- PUT `/api/passes/<serial>` sends the full specification and does not include server-owned `serialNumber` or `authenticationToken`.

Preview preset shades remain illustrative because the provider controls preset colors. Unsupported custom text/label color fields are not sent.

## Apply and test

Extract the patch bundle. It contains a patch and instructions only, so there is no duplicate TypeScript source tree for lint to scan.

From your repository root in PowerShell:

```powershell
git apply --check C:\path\to\pass-studio-fix.patch
git apply C:\path\to\pass-studio-fix.patch
npm run lint
npm test
npm run build
```

Then commit/push through your existing GitHub-to-Cloudflare pipeline. No database migration or new binding is needed for this update.

For a real-device check:

1. Save a green or purple template in Pass Studio, then switch away and back to confirm it reloads correctly.
2. Make sure the test race is assigned to that template.
3. Create a NEW test participant and issue a NEW pass. Verify the provider receives the chosen preset and the installed pass uses that theme.
4. Test mapped email, wave, category, and emergency contact values using data that differs from the preview examples.
5. If desired, update the runner through the editor to trigger a full-spec PUT to its existing provider serial.

Saving a template alone does not update already-issued passes or replace their stored initial R2 package. Existing installed passes can receive the new spec through a runner update; the original downloaded package remains the initial snapshot, as designed. Explicit POST `/api/pass/sync/<runnerId>` creates a new provider pass/package and replaces the stored serial; it is not an update of an installed old serial. Avoid using that action as a bulk style update.

Validation: 17 automated tests, TypeScript checks, and production build pass. Tests use SQLite and mocked provider/Resend/R2 calls. No paid provider calls, live wallet installation, remote writes, or deployment were performed for this fix.
