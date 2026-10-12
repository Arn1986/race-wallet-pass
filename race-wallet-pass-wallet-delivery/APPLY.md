# Apply the wallet delivery update

Prepared against Arn1986/race-wallet-pass commit 59f38002cd7c243b0b4387107e68d9cfdd4ce44a.

From your repository root in PowerShell, run:

```powershell
git apply --check C:\path\to\wallet-delivery.patch
git apply C:\path\to\wallet-delivery.patch
npm install
npm test
npm run lint
npm run build
```

Read WALLET_DELIVERY.md before rollout. It includes the private R2 bucket, D1
migration, legacy public package cleanup, organizer Access protection, and smoke
tests. Then commit and push through your existing Cloudflare deployment pipeline.

The updated-files folder contains complete replacements for every changed file
as an alternative to applying the patch. Use either approach once.

Validation: nine automated tests, TypeScript checks, and the Vite production build
passed. The patch was checked against a clean copy of the base commit.
No GitHub push, Cloudflare deployment, database mutation, or live email occurred.
