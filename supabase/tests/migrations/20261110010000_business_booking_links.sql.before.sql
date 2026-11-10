-- Committed synthetic pre-upgrade state with the address shapes production holds on 10 November
-- 2026: self-service addresses made from the owner's email and account id (one with a counter, one
-- whose owner changed email since), addresses of the name (one with the master panel's suffix, one a
-- newer practice already holds), and addresses someone chose or a fixture wrote, which must stay.
-- Runs only in the owned disposable DB.
begin;
insert into auth.users(id,email) values
 ('a1110001-0000-4000-8000-000000000001','synth.legacy.one@example.test'),
 ('a1110002-0000-4000-8000-000000000002','synth.legacy.two@example.test'),
 ('a1110003-0000-4000-8000-000000000003','synth.legacy.changed@example.test'),
 ('a1110004-0000-4000-8000-000000000004','synth.device@example.test'),
 ('a1110005-0000-4000-8000-000000000005','synth.legacy.five@example.test');
insert into public.businesses(id,name,slug,industry,timezone,created_at) values
 ('6d1a0000-0000-4000-8000-000000000001','Consultorio Sintético Enlaces','synth-legacy-one-a1110001','other','America/Argentina/Buenos_Aires','2026-05-17 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000002','Consultorio Sintético Enlaces','synth-legacy-two-a1110002-2','other','America/Argentina/Buenos_Aires','2026-05-18 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000003','Consultorio Sintético Enlaces','synth-legacy-before-a1110003','other','America/Argentina/Buenos_Aires','2026-05-19 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000004','Clínica Sintética Petrona','clinica-sintetica-petrona','other','America/Argentina/Buenos_Aires','2026-06-02 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000005','Consultorio Sintético Repetido','consultorio-sintetico-repetido-a1b2c3','other','America/Argentina/Buenos_Aires','2026-06-03 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000006','Dra Sintética Frutos','sintetica-frutos','other','America/Argentina/Buenos_Aires','2026-10-31 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000007','Duplicado sintético — no usar','duplicado-sintetico','other','America/Argentina/Buenos_Aires','2026-10-30 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000008','Verif Business VERIF_sintetico','verif-verif_sintetico','other','America/Argentina/Buenos_Aires','2026-09-04 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000009','Consultorio de demostración sintético','synth-device-a1110004eaca','other','America/Argentina/Buenos_Aires','2026-11-06 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000010','Consultorio Sintético Ocupado','synth-legacy-five-a1110005','other','America/Argentina/Buenos_Aires','2026-07-01 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000011','Consultorio Sintético Ocupado','consultorio-sintetico-ocupado','other','America/Argentina/Buenos_Aires','2026-07-02 10:00:00+00'),
 ('6d1a0000-0000-4000-8000-000000000012','Fixture sintético con su id','6d1a0000-0000-4000-8000-000000000012','other','America/Argentina/Buenos_Aires','2026-05-01 10:00:00+00');
insert into public.business_users(business_id,user_id,role,status,accepted_at) values
 ('6d1a0000-0000-4000-8000-000000000001','a1110001-0000-4000-8000-000000000001','owner','active',now()),
 ('6d1a0000-0000-4000-8000-000000000002','a1110002-0000-4000-8000-000000000002','owner','active',now()),
 ('6d1a0000-0000-4000-8000-000000000003','a1110003-0000-4000-8000-000000000003','owner','active',now()),
 ('6d1a0000-0000-4000-8000-000000000009','a1110004-0000-4000-8000-000000000004','owner','active',now()),
 ('6d1a0000-0000-4000-8000-000000000010','a1110005-0000-4000-8000-000000000005','owner','active',now());
commit;
