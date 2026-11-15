# Platform documentation verification

Accessed: **2026-11-15**. Unless a line says otherwise, every source below was read on this date.

## How this was verified (read this first)

Network limits in this session:

- **Blocked:** `docs.stripe.com`, `nextjs.org`. WebFetch failed to resolve them. Following the session's network guidance, I also did not try `cornerstonejs.org`, `supabase.com` or `dicom.nema.org` directly.
- **Reachable:** `registry.npmjs.org` (versions, and package tarballs for reading the shipped `.d.ts` files), `pypi.org` (JSON API), `raw.githubusercontent.com` / `github.com` (the vendors' own documentation sources in their repos), and WebSearch.

Each fact carries one of these labels:

| Label | Meaning |
|---|---|
| **[DOC-SRC]** | Official documentation source file, read from the vendor's GitHub repo. This is the Markdown/MDX that the docs site renders. The rendered URL is given too. |
| **[PKG]** | Read from the published npm/PyPI package itself: shipped typings, code, README or CHANGELOG. This is the strongest evidence for method names and signatures. |
| **[SEARCH]** | Taken from WebSearch result snippets of the official page. The page itself was not fetched, so the wording may be paraphrased. |
| **[SECONDARY]** | Third-party source. |
| **[COMPOSED]** | Code I wrote by combining verified API names. It was not copied from a doc and has not been run. |

---

## 0. Version snapshot (npm `latest` dist-tag, queried 2026-11-15)

Source: `https://registry.npmjs.org/<pkg>/latest`, `/-/package/<pkg>/dist-tags` and full packuments for publish times. **[PKG]**

| Package | latest | Published (UTC) | Notes (engines / peers / other tags) |
|---|---|---|---|
| fastify | **5.12.8** | 2026-11-02 | `next` = 6.0.0-alpha.6 |
| @fastify/websocket | **11.3.7** | 2026-11-04 | |
| @fastify/cookie | **11.1.5** | 2026-10-27 | |
| @fastify/rate-limit | **11.2.2** | 2026-11-02 | |
| @fastify/swagger | **9.9.4** | 2026-11-13 | |
| zod | **4.6.7** | 2026-10-12 | |
| drizzle-orm | **0.45.4** | 2026-10-08 | `rc` = 1.0.0-rc.5. v1 is **not** `latest` yet |
| drizzle-kit | **0.31.11** | 2026-09-21 | `rc` = 1.0.0-rc.5 |
| pg | **8.23.1** | 2026-09-30 | engines node >= 16 |
| vitest | **5.1.0** | 2026-11-02 | engines **node ^22.12.0 \|\| ^24 \|\| >=26**; peer vite ^6.4 \|\| ^7 \|\| ^8 |
| @playwright/test | **1.65.1** | 2026-11-13 | node >= 20 |
| typescript | **7.0.2** | 2026-07-08 | Native (Go) compiler. The package's `"."` export is only `./lib/version.cjs` plus `./unstable/*` API entry points, so the classic JS compiler API is gone. The last line with the JS API is **6.0.3** (2026-04-16). See §2.6 |
| @anthropic-ai/sdk | **1.8.0** | 2026-11-10 | peer zod ^3.25 \|\| ^4 |
| stripe | **23.1.0** | 2026-10-29 | node >= 20; pins API `2026-10-28.endive` |
| jose | **6.2.17** | 2026-11-09 | |
| pino | **10.4.0** | 2026-10-02 | |
| tsx | **4.23.15** | 2026-09-20 | node >= 18 |
| next | **16.4.6** | (16.4 released about 2026-10-06 **[SEARCH]**) | node >= 20.9.0; `canary` = 16.5.0-canary.51; no v17 tag yet |
| react / react-dom | **19.3.1** | 2026-10-14 | |
| eslint-config-next | 16.4.6 | | peer eslint >= 9 |
| eslint | 10.15.0 | | engines **node ^20.19 \|\| ^22.13 \|\| >=24** |
| typescript-eslint | 8.72.2 | | **peer typescript >=4.8.4 <6.1.0**, so it does not support TS 7 |
| @cornerstonejs/core, /tools, /dicom-image-loader, /metadata, /utils | **5.18.3** | 2026-11-13 | `beta` = 5.0.0-beta.1 (old) |
| dicom-parser | 1.8.21 | | exact peer of dicom-image-loader |
| @supabase/supabase-js | **2.119.0** | 2026-11-04 | engines node >= 22.0.0; `next` = 3.0.0-next.29 |
| @supabase/ssr | **0.12.7** | 2026-09-08 | peer @supabase/supabase-js ^2.114.0 |
| pnpm | 12.21.0 | | |

PyPI (from `https://pypi.org/pypi/<pkg>/json`) **[PKG]**

| Package | latest | Uploaded | Notes |
|---|---|---|---|
| pydicom | **3.0.2** | 2026-03-19 | Python >= 3.10. A 2.4.5 backport also shipped on 2026-03-20 |
| deid | **0.4.13** | 2026-10-16 | requires `pydicom>=3.0.0,<4.0.0` |
| dicognito | **0.19.0** | 2025-10-10 | requires `pydicom>=3.0.1`, Python >= 3.10 |

**What this means for Node 22:** use **Node >= 22.13**. ESLint 10 needs ^22.13 and Vitest 5 needs ^22.12. supabase-js needs >= 22.0.

---

## 1. Stripe

### 1a. Webhook events for subscription lifecycle and entitlements

Primary pages (not fetchable here):

- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/payments/checkout/build-subscriptions
- https://docs.stripe.com/billing/entitlements

Everything in this subsection is **[SEARCH]** unless marked otherwise.

**Stripe's provisioning guidance**

From the "Build a subscriptions integration with Checkout" guide:

- `checkout.session.completed`: "When you receive a checkout.session.completed event, use entitlements to provision the subscription." (In older wording: provision and save the customer ID.)
- `invoice.paid`: "Continue to provision each month (if billing monthly) as you receive invoice.paid events."
- `invoice.payment_failed`: "If you receive an invoice.payment_failed event, notify your customer and send them to the customer portal to update their payment method."

From the "Using webhooks with subscriptions" page:

| Event | Stripe's description / guidance |
|---|---|
| `invoice.paid` | "Sent when the invoice is successfully paid. You can provision access to your product when you receive this event and the subscription `status` is `active`." |
| `entitlements.active_entitlement_summary.updated` | "Sent when a customer's active entitlements are updated. When you receive this event, you can provision or de-provision access to your product's features." The Entitlements page adds: "Listen to the Active Entitlement Summary webhook and use the List Active Entitlements API for a given customer to execute your feature provisioning process." The summary payload's `active_entitlements` holds at most 10 entries, so re-list via the API. |
| `customer.subscription.updated` | "Sent when a subscription starts or changes. For example, renewing a subscription, adding a coupon, applying a discount, adding an invoice item, and changing plans all trigger this event." |
| `customer.subscription.deleted` | Sent when a customer's subscription ends. Revoke access here. |
| `customer.subscription.trial_will_end` | "Sent three days before the trial period ends." |
| `customer.subscription.paused` | Fires when the status changes to `paused`. Invoicing won't occur until the subscription is resumed. Not sent when only payment collection is paused. |
| `customer.subscription.resumed` | Fires when a paused subscription is resumed. Stripe's pause/resume changelog entries (`/changelog/endive/2026-09-30/pause-subscription`) say to listen to paused/resumed to revoke and restore access. |
| `invoice.payment_action_required` | "Sent when the invoice requires customer authentication." |
| `invoice.payment_failed` | Payment attempt failed. Notify the customer and send them to the portal. |
| `invoice.upcoming` | "Sent a few days prior to the renewal of the subscription". The number of days comes from your subscription settings. |
| `customer.subscription.created` | Exists (typed in SDK as `CustomerSubscriptionCreatedEvent` **[PKG]**). I did not capture an exact docs quote. |

- `charge.refunded` and `charge.dispute.created` exist (`ChargeRefundedEvent`, `ChargeDisputeCreatedEvent` in the SDK **[PKG]**). I found them **not** in Stripe's subscription-provisioning guidance. Treat them as finance/fraud signals and decide your own policy (see Unverified).
- **Delivery semantics** (https://docs.stripe.com/webhooks):
  - Endpoints "might occasionally receive the same event more than once". Log processed event IDs.
  - Stripe "doesn't guarantee the delivery of events in the order that they're generated". Don't use `created` to order events.
- **[COMPOSED] Minimal set I suggest:**
  - `checkout.session.completed`
  - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` (status is the source of truth)
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.payment_action_required`
  - `customer.subscription.trial_will_end` (email only)
  - plus `customer.subscription.paused` / `customer.subscription.resumed` if pausing is enabled
  - plus `entitlements.active_entitlement_summary.updated` if you model features with Stripe Entitlements
- **[COMPOSED] Handler pattern:** for idempotent, order-independent handling, re-fetch the subscription (`stripe.subscriptions.retrieve(id)`) inside the handler rather than trusting the payload order.

### 1b. Node SDK (`stripe` npm)

**Current major: 23.** 23.0.0 shipped 2026-09-30 and 23.1.0 on 2026-10-29. Node >= 20. **[PKG]**

**Pinned API version: `2026-10-28.endive`.** **[PKG]**

```ts
// esm/apiVersion.js in stripe@23.1.0
export const ApiVersion = '2026-10-28.endive';
export const ApiMajorVersion = 'endive';
```

Recent pins, from CHANGELOG **[PKG]**:

- 23.0.0 → `2026-09-30.endive`
- 22.6.0 → `2026-08-26.dahlia`
- 21.0.0 / 22.0.0 → `2026-03-25.dahlia`
- 20.0.0 → `2025-11-17.clover`

**Constructing the client.** Since v22, `Stripe` is a real ES class, so `new` is required. **[PKG]**

The CHANGELOG for 22.0.0 says "Stripe import is now a true ES6 class. Use `new Stripe()` to create a StripeClient instead of calling it". Some CJS snippets in the README still show `Stripe('sk_...')` without `new`. Follow the CHANGELOG.

```ts
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-10-28.endive', // typed as LatestApiVersion = this exact literal
  maxNetworkRetries: 2,            // default 1
  timeout: 80_000,                 // default 80000 ms
});
```

- `constructor(key: string, config?: StripeConfig)`. `StripeConfig.apiVersion?: LatestApiVersion`. **[PKG]** (`esm/stripe.core.d.ts`, `esm/lib.d.ts`)
- README: "`apiVersion` | `null` | … If not set, stripe-node will use the latest version at the time of release." Typings comment: "This library's types only reflect the latest API version." **[PKG]**
- **Pinning recommendation.** Pinning explicitly is harmless and makes intent visible, because it equals the SDK pin. What matters more is the webhook endpoint:
  - "Webhook events use the API version that's set during your webhook's endpoint creation. Otherwise, they use your Stripe account's default API version." **[SEARCH]** (https://docs.stripe.com/webhooks/versioning)
  - Stripe recommends matching the endpoint's `api_version` to the SDK's pinned version. **[SEARCH]**
  - So create the endpoint with `api_version: '2026-10-28.endive'`.
- **Other breaking changes in v22:** **[PKG]**
  - Callbacks removed.
  - Request params come first and `RequestOptions` second. Pass `undefined` for params when you only need options.
  - Per-request `host` override removed.
  - CJS no longer exports `.default` / `.Stripe`.
- **Other breaking changes in v23:** **[PKG]**
  - Node 18 dropped.
  - `Stripe.constructEventWithoutVerification` removed. Use `stripe.webhooks.constructEventWithoutVerification(payload)`.
  - Stalled or incomplete bodies now throw `StripeConnectionError`.
  - Tolerance semantics changed (see below).

**Webhook typings, verbatim from `esm/Webhooks.d.ts` (stripe@23.1.0) [PKG]**

```ts
export type WebhookHeader = string | string[] | Uint8Array;
export type WebhookPayload = string | Uint8Array;
export type WebhookTestHeaderOptions = {
    timestamp?: number;
    payload: string;
    secret: string;
    scheme?: string;
    signature?: string;
    cryptoProvider?: CryptoProvider;
};
constructEvent: (payload: WebhookPayload, header: WebhookHeader, secret: string, tolerance?: number, cryptoProvider?: CryptoProvider, receivedAt?: number) => Event;
constructEventAsync: (payload: WebhookPayload, header: WebhookHeader, secret: string, tolerance?: number, cryptoProvider?: CryptoProvider, receivedAt?: number) => Promise<Event>;
constructEventWithoutVerification: (payload: string) => Event;
generateTestHeaderString: (opts: WebhookTestHeaderOptions) => string;
generateTestHeaderStringAsync: (opts: WebhookTestHeaderOptions) => Promise<string>;
```

- `webhooks` exists both as a static (`Stripe.webhooks`) and on the instance (`stripe.webhooks`). **[PKG]**
- `DEFAULT_TOLERANCE: 300` seconds. **[PKG]**
- Since 23.0.0, "Passing 0 to stripe.webhooks.constructEvent now properly skips timestamp tolerance verification". **[PKG]**
- Since 23.0.1, webhook secrets made only of whitespace are rejected. **[PKG]**
- README: "you must pass the _raw_ request body, exactly as received from Stripe, to the `constructEvent()` function; this will not work with a parsed (i.e., JSON) request body." **[PKG]**

README test helper, verbatim **[PKG]**:

```js
const header = stripeClient.webhooks.generateTestHeaderString({
  payload: payloadString,
  secret,
});
const event = stripeClient.webhooks.constructEvent(payloadString, header, secret);
```

**Raw body in Fastify [COMPOSED].** This uses Fastify's documented `parseAs: 'buffer'` option. Fastify docs **[DOC-SRC]** (https://github.com/fastify/fastify/blob/v5.12.8/docs/Reference/ContentTypeParser.md): "`parseAs` (string): `'string'` or `'buffer'` … Default: `'buffer'`". A Node `Buffer` is a `Uint8Array`, so it satisfies `WebhookPayload`.

```ts
// register inside an encapsulated plugin so only the webhook route gets the raw parser
app.register(async (scope) => {
  scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  scope.post('/api/stripe/webhook', async (req, reply) => {
    const event = stripe.webhooks.constructEvent(req.body as Buffer, req.headers['stripe-signature']!, process.env.STRIPE_WEBHOOK_SECRET!);
    // dedupe on event.id, then handle
    return reply.code(200).send({ received: true });
  });
});
```

### 1c. Checkout Session (subscription mode), Billing customer portal, and the success redirect

Method names and parameter names below come from `stripe@23.1.0` typings **[PKG]**.

**Checkout**

- `stripe.checkout.sessions.create(params?: Checkout.SessionCreateParams, options?: RequestOptions)`.
- Also available: `.retrieve(id)`, `.list()`, `.update()`, `.expire()`, `.listLineItems()`.
- Key params:
  - `mode` (`'payment' | 'setup' | 'subscription'`). Doc comment: "Pass `subscription` if the Checkout Session includes at least one recurring item."
  - `line_items`
  - `customer` or `customer_email`. If `customer` is blank in subscription mode, "Checkout will create a new Customer object".
  - `client_reference_id`
  - `success_url`, `cancel_url`
  - `subscription_data` (metadata, trial, …)
  - `metadata`
  - `allow_promotion_codes`
  - `automatic_tax`
  - `ui_mode`
- `customer_creation` "Can only be set in `payment` and `setup` mode."
- **`ui_mode` values in this API version are `'elements' | 'embedded_page' | 'form' | 'hosted_page'`**, defaulting to `hosted_page`. They were added in stripe-node 21.0.0 (API `2026-03-25.dahlia`). Older posts use `hosted` / `embedded` / `custom`, which are not in the 23.x typings. `success_url` / `cancel_url` are "not allowed if ui_mode is `embedded_page` or `elements`".
- The response `Session` has `url: string | null`, `customer`, `subscription`, `status` and `payment_status`.

```ts
// [COMPOSED] hosted Checkout, subscription mode
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  line_items: [{ price: priceId, quantity: 1 }],
  customer: stripeCustomerId,                 // or customer_email
  client_reference_id: userId,
  subscription_data: { metadata: { userId } },
  success_url: `${APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${APP_URL}/billing`,
});
// redirect the browser to session.url
```

The `{CHECKOUT_SESSION_ID}` template variable in `success_url` is documented on https://docs.stripe.com/payments/checkout/custom-success-page **[SEARCH]**.

**Customer portal**

- `stripe.billingPortal.sessions.create({ customer, return_url, configuration?, flow_data?, locale?, on_behalf_of?, after_expiration? })` returns a session with `url: string`. **[PKG]**
- Portal session URLs are short-lived. Create one per click and redirect immediately. **[SEARCH]** I could not confirm the exact expiry.

**Entitlements**

- `stripe.entitlements.activeEntitlements.list({ customer })` (`customer: string` is required). **[PKG]**

**Don't trust the success redirect** **[SEARCH]** (https://docs.stripe.com/payments/checkout/fulfill-orders, https://docs.stripe.com/payments/checkout/how-checkout-works):

- Stripe says you can't rely on fulfilling only from the landing page, because customers aren't guaranteed to reach it. For example, they may lose connectivity after paying.
- Webhook-based fulfillment is required for subscriptions and for delayed-notification payment methods.
- Provision from `checkout.session.completed` / `invoice.paid` webhooks. The success page should only *display* state. It can retrieve the session by ID and poll your own DB.

---

## 2. Next.js (stable 16.4.6, React 19.3.1)

Docs below were read from `vercel/next.js` at tag **v16.4.6**, under `docs/01-app/...` **[DOC-SRC]**. Rendered at https://nextjs.org/docs/app/...

### 2.1 Proxy `/api/*` to a separate backend

The rewrites doc (`.../05-config/01-next-config-js/rewrites.mdx`, https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites) says:

> "Rewrites act as a URL proxy and mask the destination path, making it appear the user hasn't changed their location on the site."

> "Rewrites allow you to rewrite to an external URL. This is especially useful for incrementally adopting Next.js."

```js
// verbatim example from the doc
module.exports = {
  rewrites() {
    return [
      { source: '/blog', destination: 'https://example.com/blog' },
      { source: '/blog/:slug', destination: 'https://example.com/blog/:slug' }, // Matched parameters can be used in the destination
    ]
  },
}
```

- `rewrites` "can be defined as a synchronous or async function".
- "When the `rewrites` function returns an array, rewrites are applied after checking the filesystem (pages and `/public` files) and before dynamic routes."
- Order of checks (App Router): headers → redirects → **proxy** → `beforeFiles` → public/static/non-dynamic pages → `afterFiles` → dynamic routes → `fallback`.

The backend-for-frontend guide (`.../02-guides/backend-for-frontend.mdx`, https://nextjs.org/docs/app/guides/backend-for-frontend) says:

> "To forward requests to another backend, use `rewrites` in `next.config.js` or a `proxy` rewrite. When you need to validate requests, authenticate with the backend, or transform its response, use a Route Handler."

> "Send the backend only the headers and credentials it needs. Copying every incoming header also forwards the user's `Cookie` and `Authorization` values."

> The Route Handler example "reads the entire request and upstream response into memory. For large payloads or streaming responses, use rewrites instead."

> "WebSockets won't work because the connection closes on timeout, or after the response is generated." (This is in the deployment caveats for handlers.)

```ts
// [COMPOSED] next.config.ts for this project
import type { NextConfig } from 'next'
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000'
const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }]
  },
}
export default nextConfig
```

Notes for this project:

- An array of rewrites acts as `afterFiles`. Any `app/api/**/route.ts` that matches the same path is served **before** the rewrite. This follows from the documented order. Keep `/api` free of local route handlers, or use `beforeFiles`.
- **Proxy body buffering (important for DICOM uploads)** **[DOC-SRC]** (`proxyClientMaxBodySize.mdx`):
  - "When proxy is used, Next.js automatically clones the request body and buffers it in memory …"
  - "By default, the maximum body size is **10MB**. If a request body exceeds this limit, the body will only be buffered up to the limit".
  - The option is `experimental.proxyClientMaxBodySize`.
  - So: exclude `/api` from the `proxy.ts` matcher, or upload large files directly to the API/storage origin.
- `experimental.proxyTimeout?: number` exists in the 16.4.6 config typings **[PKG]**. It is not documented on the rewrites page.
- WebSocket upgrade through a rewrite to an external origin is **unverified**. Plan to connect `@fastify/websocket` clients directly to the API origin.

### 2.2 Notable changes in v16 that affect a project created today

All from the v16 upgrade guide **[DOC-SRC]** (`.../02-guides/upgrading/version-16.mdx`, https://nextjs.org/docs/app/guides/upgrading/version-16).

**Requirements:** "Node.js 20.9+ | Minimum version now `20.9.0` (LTS)", "TypeScript 5+ | Minimum version now `5.1.0`", and browsers Chrome/Edge/Firefox 111+ and Safari 16.4+.

**Turbopack is the default.** "Starting with **Next.js 16**, Turbopack is stable and used by default with `next dev` and `next build`."

- "If your project has a custom `webpack` configuration and you run `next build` … the build will **fail**". The options are `--turbopack` (ignore webpack config), migrating to `turbopack` options, or `--webpack`.
- `turbopack` is a top-level config key (formerly `experimental.turbo`).
- Webpack `resolve.fallback` maps to `turbopack.resolveAlias`. Verbatim:

```ts
const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      fs: {
        browser: './empty.ts', // We recommend to fix code imports before using this method
      },
    },
  },
}
```

**Async Request APIs.** "Starting with **Next.js 16**, synchronous access is fully removed." This applies to `cookies`, `headers`, `draftMode`, `params` (layout/page/route/default/OG and icon images) and `searchParams`. Write `const cookieStore = await cookies()`. `npx next typegen` generates the `PageProps` / `LayoutProps` / `RouteContext` helpers.

**`middleware` → `proxy`.**

- "The `middleware` filename is deprecated, and has been renamed to `proxy`".
- The named export becomes `export function proxy(request) {}`.
- "The `edge` runtime is **NOT** supported in `proxy`. The `proxy` runtime is `nodejs`, and it cannot be configured."
- Flags are renamed too, for example `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`.
- The proxy doc (`.../03-file-conventions/proxy.mdx`) says: "The `runtime` config option is not available in Proxy files."

Other changes:

- `next lint` is removed and `next build` no longer lints. Use the ESLint CLI or Biome. `@next/eslint-plugin-next` defaults to flat config.
- Parallel routes: "All parallel route slots now require explicit `default.js` files. Builds will fail without them."
- `revalidateTag(tag, profile)` needs a second argument; the single-argument form is deprecated. `updateTag` and `refresh` are new. `cacheLife` / `cacheTag` are stable.
- `cacheComponents` replaces `experimental.ppr`, `dynamicIO` and `useCache`.
- `next/image` defaults changed: `minimumCacheTTL` is 4h, `qualities` is `[75]`, local IPs are blocked, and `maximumRedirects` is 3. `images.domains` is deprecated.
- AMP and `serverRuntimeConfig` / `publicRuntimeConfig` are removed.
- Dev output goes to `.next/dev`.
- React: the App Router uses React canary releases, including 19.2 features. React Compiler support is stable (`reactCompiler`, not on by default).

### 2.3 What 16.4 adds

**create-next-app recommended defaults** **[DOC-SRC]** (`01-getting-started/01-installation.mdx`):

> "Yes, use recommended defaults - TypeScript, ESLint, No React Compiler, Tailwind CSS, No src/ directory, App Router, Cache Components, AGENTS.md"

The generated scripts are `"dev": "next dev"`, `"build": "next build"`, `"start": "next start"`, `"lint": "eslint"`. Minimum Node is 20.9.

The 16.4 blog post (https://nextjs.org/blog/next-16-4) **[SEARCH]** lists lazy compilation, smaller Turbopack output, React 19.3, Cache Components recommended for every app, `ensureStatic`, and bundle-analyzer improvements.

### 2.4 Client-only imports

From `.../02-guides/lazy-loading.mdx` **[DOC-SRC]**:

> "`ssr: false` option is not supported in Server Components. You will see an error if you try to use it in Server Components."

> "When using `React.lazy()` and Suspense, Client Components will be prerendered (SSR) by default."

So browser-only libraries must be loaded with `dynamic(() => import(...), { ssr: false })` from inside a `'use client'` component, or with `import()` inside `useEffect`.

### 2.5 Turbopack feature notes relevant to Cornerstone

From `.../03-api-reference/08-turbopack.mdx` **[DOC-SRC]**:

- Magic comments "work with dynamic `import()`, `require()`, `require.resolve()`, and `new Worker()` expressions". So `new Worker(...)` is handled.
- Module types include `wasm` and `asset`. Nothing in the doc says Turbopack resolves **bare package specifiers inside `new URL('pkg/x.wasm', import.meta.url)`**, which is what the Cornerstone codecs use (see §3).

### 2.6 TypeScript 7 interplay (important today)

- `typescript@latest` is **7.0.2**, the native port. It has no classic JS compiler API: the package exports only `./lib/version.cjs` and `./unstable/*`. **[PKG]**
- Next 16.4.6 type-checks through the project-local `tsc` CLI by default. `experimental.useTypeScriptCli` defaults to `true` (`dist/server/config-shared.js`). Its error text is "TypeScript ${version} does not provide the compiler API required by Next.js. Set experimental.useTypeScriptCli back to true … or install TypeScript 6 instead." So Next itself works with TS 7. **[PKG]**
- **`typescript-eslint@8.72.2` declares `peer typescript >=4.8.4 <6.1.0`**. Type-aware linting (and `eslint-config-next`'s TS rules) therefore expects TS **6.0.x**. **[PKG]**
- **Decision:** pin `typescript@~6.0.3` workspace-wide unless you drop typescript-eslint.

---

## 3. Cornerstone3D (v5.18.3)

Sources: `cornerstonejs/cornerstone3D` main branch docs **[DOC-SRC]**, rendered at https://www.cornerstonejs.org/docs/...; package tarballs **[PKG]**.

### 3.1 Versions and packages

`@cornerstonejs/core`, `/tools`, `/dicom-image-loader`, `/metadata` and `/utils` are all at **5.18.3** (2026-11-13). The peer pins are **exact versions** **[PKG]**:

| Package | Peer dependencies |
|---|---|
| core | `@cornerstonejs/metadata` 5.18.3, `@cornerstonejs/utils` 5.18.3 (core also depends on `@kitware/vtk.js` 36.4.1) |
| tools | `@cornerstonejs/core` 5.18.3, `@kitware/vtk.js` **36.4.1** (npm latest is 38.0.9, so don't take latest), `gl-matrix` 3.4.3, `d3-array` 3.2.4, `d3-interpolate` 3.0.1, `@types/d3-array` 3.2.1, `@types/d3-interpolate` 3.0.4 |
| dicom-image-loader | `@cornerstonejs/core` 5.18.3, `@cornerstonejs/metadata` 5.18.3, `dicom-parser` **1.8.21** |

dicom-image-loader's own dependencies include `@cornerstonejs/codec-charls` 1.2.7, `codec-libjpeg-turbo-8bit` 1.2.7, `codec-libjxl` 1.1.1, `codec-openjpeg` 1.3.6, `codec-openjph` 2.4.11 and `comlink`.

### 3.2 What changed in 5.x

From `docs/migration-guides/5x/*` **[DOC-SRC]**:

- **ESM only.** "The published `@cornerstonejs/*` packages now declare themselves as ESM (`"type": "module"`)…" (implemented with `dist/esm/package.json`) and "**CommonJS `require()` is not a supported package entry path.**" The guide also says "Bundler consumers are unaffected. webpack, Vite, Next, and similar tools resolve … identically".
- **TypeScript resolution.** Use `moduleResolution` `"bundler"`, `"node16"` or `"nodenext"`. Legacy `"node"` can turn deep types into `any`.
- **New packages.** `@cornerstonejs/utils` is introduced. `@cornerstonejs/metadata` is a shared metadata layer, and NATURALIZED metadata is the base state. Legacy provider flows still work.
- **Generic Viewport.** `ViewportType.PLANAR_NEXT` uses `setDisplaySets()`. You can opt in with `init({ rendering: { useGenericViewport: true } })`, which remaps `STACK` → `PLANAR_NEXT` behind compatibility adapters. Legacy `StackViewport` / `setStack()` still work.
- **Enums.** "The deprecated `Enums.ViewportType` enum is unchanged at runtime". New code may use `Enums.ViewportTypes` constants.
- **Removed:** `RenderingEngine.getStackViewport()`, `getStackViewports()` and `getVolumeViewports()`. Use `getViewport()` with `utilities.viewportSupportsStackCompatibility(viewport)`.
- **Fidelity indicator.** "The fidelity indicator is on by default". The viewport shows "Low Fidelity" for lossy data. Opting out (`dangerouslyDisableFidelityIndicator`) is only for apps that draw their own indicator.
- `RenderingCapabilities.webgl2` is removed; use `.webgl`.

### 3.3 Minimal current code: StackViewport from wadouri imageIds

Verbatim excerpt from the official example `packages/core/examples/wadouri/index.ts` **[DOC-SRC]**:

```ts
import type { Types } from '@cornerstonejs/core';
import { RenderingEngine, Enums, init as csRenderInit } from '@cornerstonejs/core';
import { init as initLoader } from '@cornerstonejs/dicom-image-loader';
const { ViewportType } = Enums;
// ...
await csRenderInit({ debug: { statsOverlay: debugMode } });
await initLoader();
const renderingEngine = new RenderingEngine(renderingEngineId);
const viewportInput = { viewportId, type: ViewportType.STACK, element };
renderingEngine.enableElement(viewportInput);
const viewport = renderingEngine.getViewport(viewportId) as Types.IStackViewport;
await viewport.setStack(stack);           // stack = array of imageIds
viewport.setProperties({ voiRange: ctVoiRange });
viewport.render();
```

- ImageId format, from the example helper: `'wadouri:https://ohif-assets-new.s3.us-east-1.amazonaws.com/ACRIN-Regular/CT+CT+IMAGES/CT000000.dcm'`. Frames use `&frame=N`.
- The loader registers the schemes `wadouri`, `dicomweb`, `dicomfile` and `wadors`. **[PKG]**

Typings in 5.18.3 **[PKG]**:

- `core.init(configuration?: Cornerstone3DConfig): boolean` (synchronous; `await` is harmless).
- `dicomImageLoader.init(options?: LoaderOptions): void`. `LoaderOptions` includes `maxWebWorkers`, `beforeSend(xhr, imageId, defaultHeaders, params)` (can return a headers object, which is where you'd add `Authorization`), `wasmBasePath`, `strict` and `decodeConfig`.
- `StackViewport.setStack(imageIds: string[], currentImageIdIndex?: number): Promise<string>`.
- `RenderingEngine.destroy()` and `disableElement(viewportId)` exist.
- tools: `init(defaultConfiguration?)` and `destroy()`.

```tsx
// [COMPOSED] app/(viewer)/DicomStack.tsx – client-only; load via next/dynamic({ ssr:false }) from a client parent
'use client'
import { useEffect, useRef } from 'react'
export default function DicomStack({ imageIds, getToken }: { imageIds: string[]; getToken?: () => Promise<string> }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let engine: import('@cornerstonejs/core').RenderingEngine | undefined
    let cancelled = false
    ;(async () => {
      const core = await import('@cornerstonejs/core')
      const loader = await import('@cornerstonejs/dicom-image-loader')
      if (!core.isCornerstoneInitialized()) {
        core.init()
        loader.init({
          maxWebWorkers: 2,
          wasmBasePath: '/cs-wasm/', // see 3.4 – serve codec binaries yourself
          beforeSend: async () => (getToken ? { Authorization: `Bearer ${await getToken()}` } : undefined),
        })
      }
      if (cancelled || !el.current) return
      engine = new core.RenderingEngine('viewer-engine')
      engine.enableElement({ viewportId: 'stack', element: el.current, type: core.Enums.ViewportType.STACK })
      const vp = engine.getViewport('stack') as import('@cornerstonejs/core').Types.IStackViewport
      await vp.setStack(imageIds) // e.g. ['wadouri:https://api.example.com/api/files/<id>.dcm']
      vp.render()
    })()
    return () => { cancelled = true; engine?.destroy() } // React StrictMode double-mount safe
  }, [imageIds, getToken])
  return <div ref={el} style={{ width: 512, height: 512 }} onContextMenu={(e) => e.preventDefault()} />
}
```

### 3.4 Integration requirements with Next.js (webpack and Turbopack)

1. **Client-only.** Cornerstone needs the DOM, WebGL and Workers. Next prerenders client components by default, so use `ssr: false` (from a client component) or `import()` inside `useEffect` (§2.4).

2. **Web workers.** Decoding runs in a module worker **[PKG]**:

   ```js
   new Worker(new URL('./decodeImageFrameWorker.js', import.meta.url), { type: 'module' })
   ```

   webpack 5 supports this, and Turbopack lists `new Worker()` support.

3. **WASM codecs.** Each decoder locates its binary with a **bare specifier**, for example `new URL('@cornerstonejs/codec-charls/decodewasm', import.meta.url)` **[PKG]**. The Cornerstone docs **[DOC-SRC]** (`getting-started/vue-angular-react-vite.md`, "Codec WASM location") say:
   - webpack 5 "Resolves the specifier through the package `exports` map and emits the binary as an asset. Nothing to do."
   - Vite/Rollup does the same.
   - esbuild "Does **not** resolve it".
   - Failure symptom: `CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f`.
   - The fix: `dicomImageLoaderInit({ wasmBasePath: '/assets/cs-wasm/' })` and copy the binaries there.
   - Turbopack behaviour is **not documented**. **Recommendation:** with Turbopack, set `wasmBasePath` and copy the binaries into `public/cs-wasm/` with a postinstall/prebuild script.
   - **Docs gap:** the docs list four files, but the 5.18.3 code asks for **five** through `resolveWasmUrl` **[PKG]**: `charlswasm_decode.wasm` (codec-charls), `libjpegturbowasm_decode.wasm` (codec-libjpeg-turbo-8bit), `openjpegwasm_decode.wasm` (codec-openjpeg), `openjphjs.wasm` (codec-openjph), and **`jpegxlwasm_decode.wasm` (codec-libjxl)**.

4. **`fs` in codec glue.** The Emscripten glue contains `if(ENVIRONMENT_IS_NODE){var fs=require("fs");var nodePath=require("path");…}` **[PKG]**.
   - The official webpack snippet for Next **[DOC-SRC]** is:

     ```js
     webpack: (config) => { config.resolve.fallback = { fs: false }; return config }
     ```

     Plus, from the troubleshooting section, `{ test: /\.wasm/, type: 'asset/resource' }`.
   - On Next 16 a `webpack` key makes **`next build` fail unless you pass `--webpack`** (§2.2).
   - The Turbopack equivalent is `turbopack.resolveAlias: { fs: { browser: './empty.ts' } }`.

5. **The official example is stale.** https://github.com/cornerstonejs/nextjs-cornerstone3d pins `next` 14.2.4 and `@cornerstonejs/*` 2.19.11, using a webpack-only config. **[DOC-SRC]** There is **no official Next 16 + Turbopack + Cornerstone 5 example**.
   - Safest path: `next dev --webpack` / `next build --webpack` with the documented webpack snippet.
   - Alternative: stay on Turbopack with `resolveAlias` + `wasmBasePath`, after a smoke test of JPEG-LS, JPEG 2000, HTJ2K and JPEG baseline studies.

6. **Install exact peer versions** (§3.1). Vite-only notes such as `optimizeDeps.exclude` and `viteCommonjs` don't apply to Next.

---

## 4. DICOM PS3.15 Annex E, and Python de-identification

Primary pages, which could not be fetched here:

- https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html
- https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_E.3.html

The current edition is **2026d** **[SEARCH]**. Normative wording below is **[SEARCH]** paraphrase unless marked. Tags and CID codes were verified against pydicom's dictionaries **[PKG]**. Per-attribute action codes come from `innolitics/dicom-standard` `standard/confidentiality_profile_attributes.json` **[SECONDARY]**. That is a scrape of Table E.1-1 from an older edition and may lag 2026d.

### 4.1 Basic Application Level Confidentiality Profile

- Table E.1-1 lists the standard attributes that can identify the patient, personnel, institution or instances. Each gets an action for the basic profile, and option columns override it.
- The innolitics scrape has 621 rows. Basic-profile code counts: X 384, D 92, U 54, Z 42, X/D 22, X/Z 11, X/Z/D 8, Z/D 6, X/Z/U\* 2.
- Private attributes `(GGGG,EEEE)` with an odd group are **X** (removed) unless Retain Safe Private applies (then **C**).
- The basic profile does **not** clean pixel data or recognizable features. Those are the Clean Pixel Data and Clean Recognizable Visual Features options.
- Record what was done. The standard requires that "one or more codes from CID 7050 corresponding to the Profile and Options used be added to De-identification Method Code Sequence (0012,0064)" **[SEARCH]**. Setting Patient Identity Removed (0012,0062) = `YES` is part of E.2 from my own knowledge (see Unverified).
- Relevant tags **[PKG]** (pydicom `_dicom_dict.py`):
  - `(0012,0062) PatientIdentityRemoved` CS
  - `(0012,0063) DeidentificationMethod` LO 1-n
  - `(0012,0064) DeidentificationMethodCodeSequence` SQ
  - `(0028,0301) BurnedInAnnotation` CS
  - `(0028,0302) RecognizableVisualFeatures` CS
  - `(0028,0303) LongitudinalTemporalInformationModified` CS
- Example rows **[SECONDARY]**:
  - Patient's Name **Z**
  - Patient ID **Z/D**
  - Patient's Birth Date **Z**
  - Patient's Sex **Z** (K with Patient Characteristics)
  - Patient's Age **X** (K with Patient Characteristics)
  - Study/Series/SOP Instance UID and Frame of Reference UID **U** (K with Retain UIDs)
  - Study Date **Z** (K for full dates, C for modified dates)
  - Content Date **Z/D**
  - Accession Number **Z**
  - Institution Name **X/Z/D** (K with Institution Identity)
  - Device Serial Number and Station Name **X/Z/D** (K with Device Identity)
  - Study/Series Description **X** (C with Clean Descriptors)
  - Referring Physician's Name **Z**

### 4.2 Action codes (Table E.1-1a)

There are 11 codes, a count also cited by the pymedphys PR **[SECONDARY]**. The meanings below are confirmed in gist by search snippets of NEMA, TCIA and CP-1826. The exact wording is from memory; check it before quoting.

| Code | Meaning |
|---|---|
| **D** | Replace with a non-zero length value that may be a dummy value and consistent with the VR |
| **Z** | Replace with a zero length value, or a non-zero length value that may be a dummy value and consistent with the VR |
| **X** | Remove |
| **K** | Keep (unchanged for non-Sequence attributes, cleaned for Sequences) |
| **C** | Clean: replace with values of similar meaning known not to contain identifying information and consistent with the VR |
| **U** | Replace with a non-zero length UID that is internally consistent within a set of Instances |
| **Z/D** | Z unless D is required to maintain IOD conformance |
| **X/Z** | X unless Z is required to maintain IOD conformance |
| **X/D** | X unless D is required to maintain IOD conformance |
| **X/Z/D** | X unless Z or D is required to maintain IOD conformance |
| **X/Z/U\*** | X unless Z or replacement of contained instance UIDs (U) is required to maintain IOD conformance (sequences such as Referenced Image Sequence) |

The codes apply to both Sequence and non-Sequence attributes. For a Sequence, the action applies to the Sequence and all its contents (CP-1826 **[SEARCH]**).

### 4.3 Options

CID 7050 codes (scheme DCM) were verified in pydicom `sr/_concepts_dict.py` **[PKG]**.

| Option | § (current) | CID 7050 | Effect |
|---|---|---|---|
| Clean Pixel Data | E.3.1 | 113101 | "remove any information burned in to the Pixel Data (7FE0,0010) corresponding to the Attribute information specified to be removed by the Profile". Burned In Annotation (0028,0301) "shall be added to the Data Set with a Value of NO". Superimposing an overlay or shutter is not sufficient. **[SEARCH]** |
| Clean Recognizable Visual Features | E.3.2 | 113102 | If the pixel data (or a reconstruction from a set of instances, such as a 3D face) would let an individual be recognized, remove or distort enough to prevent recognition. Recognizable Visual Features (0028,0302) = NO. **[SEARCH]** |
| Clean Graphics | E.3.3 | 113103 | Identifying text in graphics/overlays/curves (Curve Data 50xx, Overlay Data/Comments 60xx, Graphic Annotation Sequence) is cleaned (C) **[SECONDARY]** |
| Clean Structured Content | E.3.4 | 113104 | Identifying content in SR content items, Acquisition Context Sequence and Specimen Preparation Sequence is cleaned (C) |
| Clean Descriptors | E.3.5 | 113105 | Free-text descriptors (125 attributes, for example Study/Series Description) are cleaned (C) instead of removed |
| Retain Longitudinal Temporal Information: Full Dates | E.3.6 | 113106 | Dates and times are kept (K). (0028,0303) = UNMODIFIED **[SEARCH]** |
| Retain Longitudinal Temporal Information: Modified Dates | E.3.6 | 113107 | Dates and times are modified (C), "preserv[ing] the gross longitudinal temporal relationships". (0028,0303) = MODIFIED **[SEARCH]** |
| Retain Patient Characteristics | E.3.7 | 113108 | Keep sex, age, size, weight and similar (13 attributes, K/C) |
| Retain Device Identity | E.3.8\* | 113109 | Keep device identifiers such as serial number and station name (57 attributes, K/C) |
| Retain UIDs | E.3.9 | 113110 | Keep UIDs (59 attributes, K) |
| Retain Safe Private | E.3.10 | 113111 | Keep private attributes listed as safe in Table E.3.10-1 (C) instead of removing all private attributes |
| Retain Institution Identity | E.3.11\* | 113112 | Keep institution name, address and department (10 attributes, K) |

\* Section numbers inferred from ordering. Section numbers have shifted between editions **[SEARCH]**.

The basic profile itself is code **113100** "Basic Application Confidentiality Profile". Attribute counts in the table are from the innolitics scrape.

### 4.4 Python tooling

**pydicom 3.0.2** (2026-03-19) **[PKG]**

- Release note: "Fixed a security issue: a crafted DICOMDIR could set `ReferencedFileID` to a path outside the File-set root. This addresses CVE-2026-32711." Upgrade from 3.0.1.
- Data dictionary is DICOM **2024d**; concepts are 2024c (`_version.py` on main).
- **No built-in PS3.15 profile engine.** pydicom provides primitives:
  - `Dataset.walk(callback)`
  - `Dataset.remove_private_tags()`
  - `del ds.Keyword`
  - `pydicom.uid.generate_uid()`
  - CID 7050 codes in `pydicom.sr.codedict.codes` (DCM keywords such as `BasicApplicationConfidentialityProfile`)
- The official gallery example "Anonymize DICOM data" says it "is a starting point to anonymize DICOM data" (https://github.com/pydicom/pydicom/blob/main/examples/metadata_processing/plot_anonymize.py).
- The README points to **deid** "which supports the anonymization of DICOM files".

**deid 0.4.13** (2026-10-16; pydicom >=3,<4) **[PKG]**

- README: "Best effort anonymization for medical images in Python."
- Pixel cleaning "mirrors the one by CTP in that we can identify images based on known locations". The default recipe `deid/data/deid.dicom` has whitelist/graylist/blacklist filters with fixed `coordinates` per manufacturer/model.
- "We are looking for collaborators to develop and validate an OCR cleaning method!" In other words, **no OCR**.
- Header actions are recipe-driven. You must author or verify a recipe against Table E.1-1 yourself.

**dicognito 0.19.0** (last release 2025-10-10) **[PKG]**

- Pseudonymizes consistently when one `Anonymizer` instance is reused: "Use a single `Anonymizer` on datasets that might be part of the same series, or the identifiers will not be consistent".
- "Replace all UI elements", "Replace all PN elements", shifts DA/DT/TM "into the past" while keeping order, adds "DICOGNITO" to DeidentificationMethod, and "Set PatientIdentityRemoved to "YES" if BurnedInAnnotation is "NO"".
- **Does not clean pixel data.**
- It does not claim PS3.15 option-level conformance or write CID 7050 codes. That is an inference from its README list.
- Repeated `--in-place` runs shift dates further.

**Recommendation [COMPOSED]**

- Implement Table E.1-1 explicitly as a versioned rules table, using pydicom for the primitives.
- Or use `dicognito` / `deid` as a base and add:
  - PS3.15 action coverage tests
  - `PatientIdentityRemoved=YES`
  - `DeidentificationMethodCodeSequence` with 113100 plus the option codes you actually implement
  - `LongitudinalTemporalInformationModified` when dates are shifted
  - a mandatory pixel review / Burned In Annotation gate, because none of these tools do OCR
- Treat ultrasound, secondary capture and screenshot series as burned-in-risk by default.

---

## 5. Supabase Auth: verifying access tokens on a separate API

Sources: `supabase/supabase` master branch **[DOC-SRC]**:

- `apps/docs/content/guides/auth/jwts.mdx` → https://supabase.com/docs/guides/auth/jwts
- `signing-keys.mdx` → /docs/guides/auth/signing-keys
- `jwt-fields.mdx` → /docs/guides/auth/jwt-fields
- `auth-mfa.mdx`
- `server-side/creating-a-client.mdx`
- `getting-started/api-keys.mdx`

Package typings came from `@supabase/auth-js` 2.119.0 and `@supabase/ssr` 0.12.7 **[PKG]**.

### 5.1 JWKS endpoint and key types

- **JWKS endpoint:** `GET https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`.
  - "Be aware that this endpoint does not return any keys if you are not using asymmetric JWT signing keys."
  - The `iss` claim is `https://<project-ref>.supabase.co/auth/v1`, and "If you append `/.well-known/jwks.json` to this URL you'll get access to the public keys".
- **Signing systems:**
  - Legacy JWT secret: "**No longer recommended.**"
  - Signing keys: asymmetric (RSA, EC) or shared secret.
  - Asymmetric signing keys are "the default for new projects" (SSR doc).
- **Algorithms:**
  - `ES256` (P-256) is recommended.
  - `RS256` is supported, but "We recommend using the P-256 elliptic curve instead".
  - `EdDSA` is "Coming soon".
  - `HS256` is "**Not recommended for production applications.**"
- **HS256 projects:** "we recommend always verifying a user access token directly with the Auth server". In other words, call `GET /auth/v1/user` with `apikey` and `Authorization: Bearer <JWT>`; HTTP 200 means valid. Verifying locally with the shared secret: "**We strongly recommend against this approach.**"
- **Caching:**
  - The endpoint is "cached by the Supabase Edge for 10 minutes". "Furthermore the Supabase client libraries may cache the keys in memory for an additional 10 minutes".
  - "We recommend waiting at least 20 minutes when creating a standby signing key, or revoking a previously used key."
  - "Make sure that you do not cache this data for longer in your application".
  - `jose` `createRemoteJWKSet` defaults **[PKG]**: `cacheMaxAge` 600000 ms (10 min), `cooldownDuration` 30000 ms, `timeoutDuration` 5000 ms.

Official verification example, verbatim from `jwts.mdx`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'

const PROJECT_JWKS = createRemoteJWKSet(
  new URL('https://project-id.supabase.co/auth/v1/.well-known/jwks.json')
)

async function verifyProjectJWT(jwt: string) {
  return jwtVerify(jwt, PROJECT_JWKS)
}
```

`jose@6.2.17` `JWTVerifyOptions` includes `issuer`, `audience`, `algorithms`, `clockTolerance` and `requiredClaims` **[PKG]**. A hardened version for Fastify **[COMPOSED]**:

```ts
const ISSUER = `https://${PROJECT_REF}.supabase.co/auth/v1`
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`))
const { payload } = await jwtVerify(token, JWKS, {
  issuer: ISSUER,
  audience: 'authenticated',
  algorithms: ['ES256', 'RS256'],
})
// payload.sub = user id; payload.role === 'authenticated'; payload.aal === 'aal2' for MFA-gated routes
```

**Alternative.** `supabase.auth.getClaims(jwt?, { allowExpired?, jwks? })` "Extracts the JWT claims present in the access token by first verifying the JWT against the server's JSON Web Key Set endpoint". With a symmetric key, "it always sends a request to the Auth server". Its return type is `{ data: { claims, header, signature }, error: null } | { data: null, error }`. **[PKG]**

### 5.2 Claims

From `jwt-fields.mdx`, verbatim lists.

**Required claims:** `iss`, `aud` (`string | string[]`: `"authenticated"` or `"anon"`), `exp`, `iat`, `sub` (user UUID), `role` (`anon` / `authenticated` / `service_role`), `aal` (`aal1` / `aal2`), `session_id`, `email`, `phone`, `is_anonymous`.

**Optional claims:** `jti`, `nbf`, `app_metadata`, `user_metadata`, `amr` (array of `{ method, timestamp }`).

`amr.method` values: `oauth`, `password`, `otp`, `totp`, `recovery`, `invite`, `sso/saml`, `magiclink`, `email/signup`, `email_change`, `token_refresh`, `anonymous`.

**MFA** (`auth-mfa.mdx`):

- `aal1` means a conventional sign-in. `aal2` means "additionally verified using at least one second factor".
- "JWTs without an `aal` claim are at the `aal1` level."
- `amr` "entries are ordered most recent method first!"
- An RLS example is `(select auth.jwt()->>'aal') = 'aal2'`.
- Unenrolling a factor downgrades `aal2` → `aal1` only after refresh.

**Validation guidelines:** check required fields and types, "Validate `exp`", "Ensure `iss` matches your Supabase project", "Validate `aud` matches expected audience", "Always validate the JWT signature before trusting any claims".

### 5.3 Keys and SSR

**API keys** (`api-keys.mdx`):

- Publishable key `sb_publishable_...` is low privilege and safe to expose.
- Secret key `sb_secret_...` bypasses RLS and is backend-only.
- `anon` and `service_role` are the "Legacy" equivalents.
- Environment variable names in the docs: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.

**@supabase/ssr 0.12.7** with Next 16:

- `createServerClient(url, key, { cookies: { getAll(), setAll(cookiesToSet, headers) } })`. `setAll` receives cache headers (`Cache-Control`, `Expires`, `Pragma`) that "must be applied to the HTTP response". `createBrowserClient(url, key)` is a singleton.
- Session refresh lives in **`proxy.ts`**: `export async function proxy(request: NextRequest) { return await updateSession(request) }`.
- "On Next.js 15 and earlier, a `proxy.ts` file is never called". The cookie is named `sb-<project_ref>-auth-token`.
- "_Never_ trust `supabase.auth.getSession()` inside server code such as Proxy." "Always use `supabase.auth.getClaims()` to protect pages and user data."

**Recommendation for the Fastify API [COMPOSED]:**

- Have the web app send `Authorization: Bearer <access_token>`, taken from `session.access_token` in the browser client, on `/api/*` calls.
- Verify it with `jose` against the JWKS as above. Don't parse the chunked, `base64-`-prefixed SSR cookie on the API.
- Exclude `/api` from the Next `proxy.ts` matcher (see the 10MB buffering note in §2.1).

---

## Unverified / open items

1. **Stripe page wording.** docs.stripe.com wording in §1a and §1c comes from search snippets; I did not fetch the pages. In particular:
   - the exact "minimum events" list on the Checkout subscriptions guide
   - whether Stripe explicitly recommends `customer.subscription.created`
   - how `charge.refunded` / `charge.dispute.created` fit, since they are absent from the subscription guidance I could see
   - the exact portal-session expiry
   - the third-party claim that Checkout waits up to 10 s for your `checkout.session.completed` response before redirecting
2. **Stripe `ui_mode` values.** Whether `hosted` / `embedded` / `custom` are still accepted at runtime on `2026-10-28.endive` (the 23.x typings list only the four new values).
3. **Next.js rewrites to an external origin:**
   - whether WebSocket upgrades are proxied
   - whether `Cookie` / `Authorization` headers are always forwarded unchanged
   - whether env vars read inside `rewrites()` are evaluated at build time or at `next start` (assume build time)
   - the behaviour and units of `experimental.proxyTimeout`, which appears only in typings
4. **Turbopack + Cornerstone codecs.** Whether Turbopack resolves Cornerstone's bare-specifier `new URL('@cornerstonejs/codec-*/…wasm', import.meta.url)`. This is undocumented on both sides. Mitigate with `wasmBasePath` plus copied binaries, or use `--webpack`.
5. **wadouri metadata in 5.x.** Whether wadouri stacks render correctly in 5.18.3 with no extra metadata prefetch, using the default NATURALIZED providers. The official `examples/wadouri` suggests yes. Confirm with a smoke test.
6. **DICOM PS3.15 2026d wording.** Exact normative text of E.2, the E.3.3–E.3.5 and E.3.7–E.3.11 options, and Table E.1-1a. Specifically:
   - the requirement to set Patient Identity Removed (0012,0062) = YES (my knowledge; not re-verified)
   - the section numbers for Retain Device Identity (E.3.8) and Retain Institution Identity (E.3.11)
   - per-attribute codes, which come from a third-party scrape of an older edition
7. **Next.js 16.4 release date.** Search sources disagree between 2026-09-29 and 2026-10-06.
8. **TypeScript 7 in the wider toolchain.** Compatibility of TS 7 with Vitest typecheck, drizzle-kit and @fastify/swagger type providers was not checked. Only typescript-eslint's peer range (<6.1.0) and Next's CLI type-check path were verified.
