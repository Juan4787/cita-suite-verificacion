# Web Natalia

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Astro, TypeScript and Tailwind, approved in the implementation proposal. Cita Suite retains its SvelteKit booking engine and authenticated panel.

## Users
Patients booking with Natalia; Natalia and Yari manage independent schedules in Cita Suite.

## Product Purpose
A public professional website connected to autonomous appointments. Patients review the fee for their chosen date, reserve through Cita Suite, and provide professional-required information that updates their profile while preserving the submission history.

## Capabilities and Constraints
Real schedules, services, prices, clinical questions and unconfirmed public contact details are pending configuration. The user explicitly declines supplying these now. Develop and verify using isolated synthetic fixtures; do not promote reference content or fixture data into operational configuration. Patient document uploads and public WhatsApp contact start disabled and require practice configuration. Automated WhatsApp notifications remain excluded. Deposits, packages, consultation preparation billing and new reminder schedules/channels remain outside this delivery. Tests and builds run sequentially on this low-memory host.

## Brand Commitments
Preserve the supplied WEB NATALIA mockup identity and photography. It is a reference, not an operational data source.

## Evidence on Hand
WEB NATALIA/index.html, styles.css, app.js and assets; the user-provided consultation requirements; the existing shared booking integration. No invented clinical, commercial or credential facts may be promoted into operational configuration.

## Product Principles
One reservation engine. Clinical information and documents remain private. Professionals determine required fields. Failed later submissions or uploads do not remove a reservation. Preserve historical forms, submissions, accepted fee quotes and instructions. Public editorial content and the later information form work without JavaScript; file uploads require JavaScript and explain that limitation. Use labeled native controls and human, actionable errors; preserve entered drafts after a failed save. Measure performance before and after.

## User steering
Required booking fields and automatic patient-profile persistence are authorized. The earlier deferral of patient study uploads is superseded by the document authorization of 2026-10-14 below.

The user rejected the first Astro port because it removed much of the supplied public site and the internal demo screens. Preserve the restored complete public surface, its design, content and navigation. The public reference includes ten sections, four consultation cards and details, three courses, three complete articles and readers, three supplied testimonials, ten training entries, six questions, complete contact layout and footer. Classroom/LMS work, course administration and news administration are explicitly postponed; preserving their supplied public content does not authorize implementing or publishing those platforms or scheduling them as the next stage. Neither an initial performance budget nor missing operational configuration authorizes removing a section.

Supplied editorial identity and copy are preserved without treating the mockup as verified operational configuration. Reference fees and durations are labeled; live availability and prices come from Cita Suite. Contact details remain pending rather than invented. Public course actions explain that enrollment, payments and student access are not yet enabled; no fake payment, registration, message submission or clinical-upload success may be shown.

## Scope update 2026-10-14
This is an ordinary extension of the existing booking and management surfaces. Preserve Natalia's warm paper, terracotta, Newsreader/Hanken Grotesk and existing cream contact controls; preserve Cita Suite's own authenticated management identity and configurable public booking appearance. No replacement visual world is authorized.

- **Patient flow:** service → date → review the updated fee and continue → time → required form → reservation → later information and documents. The reservation operation validates and preserves the accepted quote; a stale quote cannot silently confirm a different fee.
- **Fees:** the practice manually enters a recurring percentage and exceptions for individual months, including changes to the recurring rate from a selected month. New monetary policies use ARS and whole pesos. Preserve exact accumulated precision and round only the final quote; do not obtain IPC automatically or recalculate existing reservations.
- **Clinical intake:** configurable questions update the patient profile and medical history where mapped. Preserve prior answers, schema versions and submission snapshots. Identify patient declarations as such; do not present them as a professional diagnosis.
- **Documents:** patient and professional uploads of JPG, PNG and PDF are authorized. Each file is limited to 5 MB; patient uploads are limited to three documents and 10 MB per appointment. The global project budget is 700 MB, with pending upload leases accounted separately from actual patient document sizes. MB are decimal units. Use private storage, authorized downloads named with the patient's name and surname, and the original bytes. PDF validation is basic metadata plus bounded Range checks; no asynchronous structural parser or future validation queue is part of this scope. PDFs are not opened or downloaded automatically.
- **Schedules:** one panel manages time blocks by service, including follow-up, and blocks on separate dates. A restricted block with no permitted service stays closed. Preserve existing appointments and require acknowledgment when a new block overlaps them.
- **Instructions and reminders:** preserve patient instructions and a separate short public description for reminders, with per-appointment snapshots. Public reminders must not inherit clinical notes, questionnaire answers or medication automatically.
- **Contact:** WhatsApp is a contact link using a confirmed number with country code, independent of online booking availability. Its enablement is separate from messaging settings. No automated WhatsApp notifications or invented contact details.
- **Postponed:** preserve existing course/news content and destinations. Do not implement classroom/LMS, enrollment, payment, student access or course/news administration without new authorization.

## Verification and activation status
The extension is implemented and checked locally with isolated synthetic data. Local PostgreSQL, PostgREST and Storage API checks use simulated Auth and loopback transport adaptations; they do not prove production activation, real Auth, provider S3, physical-device push delivery or billed egress. New migrations were not applied to production and no deployment was performed. Keep unconfigured and opt-in features disabled until real practice data and the destination are confirmed. The 700 MB budget does not guarantee indefinite Free-tier operation.

Current contracts, evidence and visual-documentation notes: [booking extension contract](../../docs/audits/2026-10-14-booking-extensions-contract.md), [implementation ledger](../../docs/audits/2026-10-14-implementation-ledger.md) and [design notes](../../docs/audits/2026-10-14-ui-extension-design-notes.md).
