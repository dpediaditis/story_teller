# Apple Developer Program — what it's actually for

## Correction first

I've been telling you to "enrol today". That was overstated. **You can test on
your own physical iPhone without paying anything**, via Xcode free provisioning
(7-day certificates). What you cannot do for free is TestFlight, the App Store,
Sign in with Apple, or in-app purchases.

So the honest sequencing is below.

## What you do NOT need it for

| Works free, today | How |
|---|---|
| The whole app in Expo Go on your phone | `cd apps/mobile && pnpm start`, scan the QR |
| iOS Simulator, including dev builds | No provisioning required at all |
| All backend work — schema, Edge Functions, worker | Local Docker + Supabase |
| Real story generation end to end | Only needs Supabase + a Gemini key |
| Installing a dev build on **your own** device | Xcode free provisioning, 7-day expiry, re-sign weekly |

**Everything currently built runs without paying Apple a cent.** The one gap is
the Vision module, and even that can be tested on your own device via Xcode.

## What genuinely requires the $99/year programme

| Needs it | Why | When you'll hit it |
|---|---|---|
| **Sign in with Apple** | Needs an App ID with the capability, a Services ID and a signing key. No free path. | When you stop using anonymous auth |
| **In-app purchases** | Products are created in App Store Connect, which requires enrolment. RevenueCat has nothing to point at without it. | Testing the paywall for real |
| **TestFlight** | Any beta tester who isn't you | Milestone 7 — the 30-family beta |
| **App Store** | Obviously | Launch |
| **EAS Build for devices** | Its managed provisioning needs a paid team. (Local Xcode builds don't.) | When free provisioning gets annoying |
| **Push notifications** | APNs keys require enrolment | "We'll tell you when it's ready" |

Note that **Sign in with Apple is mandatory** under App Review Guideline 4.8
because we offer Google sign-in. It isn't optional at launch.

## The one thing that *is* genuinely blocked

`packages/vision-module` isolates the drawing on-device using
`VNGenerateForegroundInstanceMaskRequest`. **Subject lifting behaves differently
in the Simulator than on real hardware**, and the case most likely to embarrass
the product — pale pencil on white paper, where the ink-extraction fallback has
to take over — is exactly the case the Simulator won't tell you the truth about.

That needs a real device. It does **not** need a paid account: free provisioning
is enough to validate it.

## Recommended order

1. **Now, free** — Supabase + Gemini keys. Get real stories generating. This is
   where the actual risk lives: DECISIONS.md §14 says the cost model is still
   unvalidated, and §11's economics rest on it.
2. **Now, free** — Xcode free provisioning, test the Vision module on your
   iPhone against 20+ real children's drawings across crayon, marker and pencil.
   Milestone 0's acceptance bar is >85% clean isolation on crayon/marker and
   >60% on pencil.
3. **Then, $99** — enrol when you want Apple sign-in, IAP, or TestFlight.
   Enrolment usually takes 24–48h but can run longer, so start it a week before
   you actually need it, not the day of.

Paying now buys you nothing you can use this week.

---

# Steps

## A. Free device testing (do this first)

1. Install Xcode from the Mac App Store.
2. Xcode → Settings → Accounts → add your regular Apple ID (free).
3. Generate the native project:
   ```
   cd apps/mobile && npx expo prebuild --platform ios
   ```
4. `open ios/Papercub.xcworkspace`
5. Select the Papercub target → Signing & Capabilities → tick *Automatically
   manage signing* → pick your Personal Team.
6. If the bundle id is taken, change it to something unique
   (`com.<yourname>.papercub`) and update `APPLE_BUNDLE_ID` in `.env`.
7. Plug in your iPhone, select it as the run destination, press ⌘R.
8. On the phone: Settings → General → VPN & Device Management → trust your
   developer certificate.

Expires after 7 days; press ⌘R again to re-sign. Fine for validating Vision.

## B. Paid enrolment, when you need it

1. https://developer.apple.com/programs/enroll — $99/year.
2. Enrol as an **individual** unless you have a registered company with a
   D-U-N-S number; organisation enrolment is much slower.
3. You'll need two-factor auth on your Apple ID and, usually, photo ID.
4. Wait 24–48h.
5. Copy Team ID from Membership details → `APPLE_TEAM_ID` in `.env`.

## C. Sign in with Apple (after enrolment)

1. Certificates, Identifiers & Profiles → Identifiers → your App ID → enable
   **Sign In with Apple**.
2. Identifiers → **+** → Services ID (e.g. `com.papercub.app.signin`) → enable
   Sign In with Apple → configure:
   - Primary App ID: your App ID
   - Return URL: `https://<project-ref>.supabase.co/auth/v1/callback`
3. Keys → **+** → enable Sign In with Apple → download the `.p8` **once**
   (Apple will not let you download it again).
4. Supabase → Authentication → Providers → Apple: paste Services ID, Team ID,
   Key ID and the `.p8` contents.

## D. Google sign-in (independent of Apple — you can do this now)

1. https://console.cloud.google.com → new project → APIs & Services →
   OAuth consent screen (External).
2. Credentials → Create OAuth client ID → **iOS** → bundle id
   `com.papercub.app` → gives `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
3. Credentials → Create OAuth client ID → **Web application** → authorised
   redirect URI `https://<project-ref>.supabase.co/auth/v1/callback` → gives
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and the secret.
4. Supabase → Authentication → Providers → Google: paste the **Web** client id
   and secret.

The Web client id is what Supabase validates the id-token audience against, so
it matters more than the iOS one.

## E. In-app purchases (needs enrolment)

1. App Store Connect → My Apps → **+** → bundle id from `.env`.
2. Subscriptions → create group "Papercub Family" → add:
   - `papercub_family_monthly` EUR 7.99
   - `papercub_family_annual` EUR 79.99
   Turn **Family Sharing ON** for the group — DECISIONS.md §12 says a
   two-parent household must not pay twice, and that toggle is the only way.
3. In-App Purchases → Consumable → `papercub_topup_3` EUR 4.99.
4. Agreements, Tax and Banking → complete the **Paid Apps** agreement.
   Nothing sells until this is signed; it is the most commonly missed step.
5. Point RevenueCat at these products, then fill Step 3 of `.env`.
6. Install the SDK: `cd apps/mobile && npx expo install react-native-purchases`
