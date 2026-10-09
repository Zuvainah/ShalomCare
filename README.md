# ShalomCare AI — backend and safe symptom workflow

This private educational prototype uses a Sites Worker and Cloudflare D1 (SQLite-compatible) because Sites runs backend code as Workers and does not host a long-running Node/Express process or a local SQLite file. The API uses the Worker Fetch interface and parameterized D1 statements. AI is accessed only by a replaceable backend provider adapter.

## API

- GET /api/health
- GET /api/articles and GET /api/articles/:id return only approved, non-demo articles.
- GET /api/facilities?q=&region=&limit=&offset= and GET /api/facilities/:id return only verified, non-demo facilities and verified contacts/services.
- GET /api/symptoms/questions?category= and POST /api/symptoms/check provide the structured symptom workflow. The endpoint checks approved rules after each answer, can return emergency guidance before the questionnaire finishes, and never stores or echoes individual answers. The public checker remains disabled until qualified clinical review is recorded.
- POST /api/assistant accepts a general health-information question, uses only approved non-demo articles as context, and returns a plain-language answer with article references. Requests are rate-limited to 10/minute per salted IP bucket, capped at 1,200 characters, and the provider call times out after 10 seconds. No question text is stored in the application database or audit log.
- POST /api/admin/bootstrap creates the first administrator only when the trusted Sites identity header matches ADMIN_BOOTSTRAP_USER_ID and no administrator exists.
- POST /api/admin/session, GET /api/admin/session, DELETE /api/admin/session
- Protected GET/POST /api/admin/articles, PATCH /api/admin/articles/:id, GET/POST /api/admin/facilities, and PATCH /api/admin/facilities/:id.
- Protected GET /api/admin/symptoms exposes review status and draft/approved rule metadata to admins; POST /api/admin/symptoms/disable can suspend public use immediately. Clinical review/activation requires a manually verified reviewer record; no clinical reviewer is configured in this prototype.

All errors use a consistent error object; successful responses include a data field. Lists accept limit (1–50) and offset. Admin changes and audit events are inserted together. Audit events contain only admin ID, action, entity type/ID and timestamp.

## Database setup

1. The Sites deployment declares a logical D1 binding named DB in .openai/hosting.json; Sites provisions the production database. Apply all ordered SQL migrations in `drizzle/` for production, including `0002_symptom_safety_gate.sql`.
2. For local SQLite, use Node.js 22+ and run `node scripts/init-local-db.mjs`. An optional argument selects another database path. The initializer applies every ordered migration. Demo seeds are clearly labeled fictional draft articles and one unverified facility; there are no verified contacts/services and no enabled symptom questions or rules.
3. Run node --test tests/*.test.mjs for the API test suite; tests use the same migration against Node's built-in SQLite engine.
4. The initial production database contains no approved articles, verified facilities, administrator accounts, or reviewed symptom rules. Do not add real clinic details until verified.

## Symptom checker safety gate

The questionnaire is health information and referral only, not a diagnostic system. Its workflow is input validation → clinician-approved safety rules → urgency classification → approved guidance. There is no AI response in the safety path. The categories (pain or discomfort, breathing concern, fever or feeling unwell, injury, other) are navigation labels only and do not imply that a clinical workflow exists for them.

All questions and rules default to draft/disabled. The `symptom_engine_settings` record defaults to `public_enabled=0`. Database checks and triggers require review metadata before individual content can be enabled; engine activation additionally requires at least one approved emergency rule. A clinician must be verified manually in `clinical_reviewers` by the Site owner after checking qualifications/registration. No self-asserted admin checkbox grants clinical review status. A qualified reviewer must review every question, answer option, rule, outcome wording, emergency instruction and referral before activation. The current deployment has no such review, so the public screen displays that the checker is unavailable and recommends professional assessment. Emergency contact guidance is shown independently of any symptom response.

Public answers are held only in browser memory and request memory; they are not persisted, logged, returned, or used for AI. The user is not asked for a name, phone number or exact address. If the engine is later enabled, POST `/api/symptoms/check` tests enabled emergency rules on every step and returns an emergency result before asking more questions. Unmatched, conflicting, incomplete or unsupported patterns receive a limitation message and recommendation for professional assessment.

Automated test fixtures use synthetic `TEST ONLY` content and artificial reviewer metadata inside a temporary in-memory test database solely to exercise code paths. They are not clinical rules, do not validate clinical outcomes and must never be promoted to production. Before public clinical use, a qualified healthcare professional must review and approve the clinical content, language, referral process and emergency workflow, and deployment monitoring/privacy/security procedures must be reviewed.

## AI assistant

Configure `AI_API_KEY` as a secret in the Sites environment. Optional `AI_API_URL` and `AI_MODEL` values select another OpenAI-compatible HTTPS endpoint/model without changing the UI or route. Never set these values in frontend assets or source control. If no key is set, no approved non-demo article exists, or the provider fails/times out, the route returns a clear unavailable message. Provider requests contain only the user's question and the latest five approved, non-demo article excerpts; they do not contain names, IP addresses, facility records, symptom questionnaire answers, or any database credentials. The IP address is used only to form a salted short-term rate-limit bucket and is not sent to the provider.

Fixed backend safety instructions constrain the assistant to approved excerpts, plain-language explanation, no diagnosis, urgency assessment, medicines, individualized dosage or treatment, and no invented sources or operational claims. User prompts and article text are explicitly treated as untrusted. Emergency-related terms trigger a fixed backend message before a provider request, without attempting clinical classification. This deterministic handling is a software guard and has not been clinically validated. The browser also warns users not to submit identifying details, but backend safety does not depend on that warning.

Configure a high-entropy `RATE_LIMIT_SALT` secret as before. Keep provider credentials in Sites runtime secrets, rotate them through Sites if exposed, and review provider data handling/privacy terms before public clinical use. No AI can override symptom safety rules because the assistant receives no symptom-checker answers and the symptom checker does not call AI.

## Offline and installable app

The PWA caches only the public application shell and the response to `/api/articles?offline=approved`. That route is handled by the service worker, which refreshes the normal approved articles endpoint, excludes demo/draft items, and saves article text with an update timestamp. Offline copies are labeled stale when refresh fails. If no copy exists, the screen reports that approved content cannot be refreshed. Cache entries for old app versions are removed during service-worker activation. Users can clear saved article content from the Privacy page.

The service worker does not intercept/cache other API routes. AI conversation history, symptom submissions, clinics, login/session/admin endpoints and tokens are never written to Cache Storage. AI, symptom questionnaire and live facility information require connectivity. Offline articles do not establish that contacts, clinic availability, or emergency guidance are current.

To install on Android, open the HTTPS Site in Chrome, visit it once while online, and use Chrome's menu → **Install app** (or **Add to Home screen**, depending on Chrome version). After loading the Health Information page while online, eligible approved public articles are saved for offline reading. The Home Screen icon launches the standalone app. Keep Chrome and Android WebView reasonably current for service-worker/PWA support.

Hosting must use HTTPS (localhost is the browser's development exception), serve the manifest with a JSON manifest MIME type, serve root-scoped `/sw.js` from the Site origin with JavaScript MIME type and no long-lived immutable cache, and permit service workers/Cache Storage. This Sites Worker serves the manifest, script and icons at the origin root. PWA offline support does not provide offline AI.

`npm test` includes service-worker simulation tests for online article refresh, offline reload/stale article return, a missing-cache response, app-version cache cleanup, and removal of cached articles. It asserts that `/api/assistant`, `/api/admin/*`, `/api/symptoms/*` and `/api/facilities` are never intercepted. These are software tests; a final device/browser check should still be done on Android Chrome after deployment.

## Administrator setup and security

Set ADMIN_BOOTSTRAP_USER_ID to the owner's trusted oai-authenticated-user-id from Sites before first use. The first administrator enters their email and a password of at least 12 characters through the bootstrap endpoint. The endpoint is one-time: it stops creating accounts as soon as an admin exists. Remove the variable after bootstrap.

Admin passwords use PBKDF2-HMAC-SHA-256 (310,000 iterations, per-password random salt). Sessions use an opaque random token, store only its SHA-256 digest in D1, expire after 8 hours, and use Secure, HttpOnly, SameSite=Strict, __Host- cookies plus a CSRF token and origin check for writes. Set RATE_LIMIT_SALT as a random Sites secret; it salts hashed client addresses in the short-lived login rate-limit table. Never put these values in frontend code or source control.

Security headers include a restrictive CSP, frame denial, MIME sniffing protection, referrer policy, and permissions policy. Input is length-limited and plain-text only. There is no patient-record endpoint or health-answer persistence.

## Tests

Run npm test and npm run validate. Tests exercise routes against actual SQLite via Node's built-in node:sqlite adapter, including error and unauthorized paths. The local tests do not replace production clinical, penetration, or privacy review.
