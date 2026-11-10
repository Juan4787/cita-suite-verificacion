-- Booking links name the practice (Juan, 10 November 2026): app.cita-suite.com.ar/reservar/consultorio-ramirez,
-- by default for every new practice. Until now the link shown was the practice id, because the
-- address that self-service signup created was the owner's email name and the start of the account
-- id (cuentaprueba3-855fc174), which also published part of the email.
--
-- 1. A practice created by the master panel or by self-service takes its address from its name and
--    follows it when the name changes (slug_follows_name). An address chosen by hand, or written
--    directly by an operator or a fixture, never changes by itself: the fixtures find and delete
--    their practices by address.
-- 2. Every address a practice leaves keeps leading to it (private.business_slug_aliases), and no
--    other practice can take it: a patient with an old link never books with someone else.
-- 3. Existing practices whose address is still an automatic one (from the owner's email, or from
--    the name) take it from the name now, oldest first. An address someone chose (natalia-frutos)
--    stays.
--
-- The app in production keeps working on this schema: its links use the id, its practice settings
-- send back the address they show, and both creation functions keep their signatures. Only an old
-- address that point 3 replaced stops opening there, until the app that follows aliases is deployed.
begin;

alter table public.businesses add column slug_follows_name boolean not null default false;
comment on column public.businesses.slug_follows_name is
 'The booking address comes from the name and changes with it. False: someone chose it, and only an explicit change moves it.';

create table private.business_slug_aliases (
 slug text primary key,
 business_id uuid not null references public.businesses(id) on delete cascade,
 retired_at timestamptz not null default now()
);
create index business_slug_aliases_business_idx on private.business_slug_aliases(business_id);
revoke all on private.business_slug_aliases from public,anon,authenticated,service_role;
comment on table private.business_slug_aliases is
 'Addresses a practice used before. They keep leading to it, and no other practice can take them.';

-- The address a name gives. The app shows the same one while it is typed
-- (apps/web/src/lib/booking/booking-link.ts): both rules share the vectors of
-- supabase/tests/business_booking_links.sql and booking-link.test.ts.
create function private.business_slug_from_text(p_value text) returns text
language sql immutable parallel safe set search_path=pg_catalog,pg_temp as $$
 select btrim(left(btrim(regexp_replace(lower(regexp_replace(normalize(coalesce(p_value,''),NFD),
  '['||chr(768)||'-'||chr(879)||']','','g')),'[^a-z0-9]+','-','g'),'-'),80),'-')
$$;

-- The first free address from a base: the base, then base-2, base-3... Free means that no other
-- practice uses it now or used it before, and that it is not shaped like an id, which the booking
-- link reads as one. Every writer of an address takes the same lock on it first, so two practices
-- never pick the same free address at once.
create function private.available_business_slug(p_base text,p_business_id uuid) returns text
language plpgsql volatile set search_path=pg_catalog,pg_temp as $$
declare
 v_base text:=coalesce(nullif(p_base,''),'consultorio');
 v_candidate text;
 v_number integer:=1;
begin
 loop
  v_candidate:=case when v_number=1 then v_base
   else btrim(left(v_base,79-length(v_number::text)),'-')||'-'||v_number end;
  perform pg_advisory_xact_lock(hashtextextended('business-slug:'||v_candidate,0));
  exit when v_candidate!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and not exists(select 1 from public.businesses b where b.slug=v_candidate and b.id<>p_business_id)
   and not exists(select 1 from private.business_slug_aliases a where a.slug=v_candidate and a.business_id<>p_business_id);
  v_number:=v_number+1;
  if v_number>1000 then raise exception 'BUSINESS_SLUG_UNAVAILABLE' using errcode='23505'; end if;
 end loop;
 return v_candidate;
end $$;

-- A practice that follows its name takes the first free address of the name when it is created,
-- starts following it, or changes to a name with another address; a name with the same address
-- keeps the current one. An address written explicitly is someone's choice: it stops following the
-- name, and it must not be one that another practice used before. Its shape is the app's to check
-- (practice settings refuse one shaped like an id): fixtures write the practice's own id as its
-- address, which the booking link resolves to the same practice.
create function private.assign_business_slug() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 v_base text;
 v_assign boolean;
 v_check boolean;
begin
 -- OLD exists only on an update: no branch reads it on an insert.
 if tg_op='INSERT' then
  v_assign:=new.slug_follows_name;
  v_check:=not new.slug_follows_name;
 else
  if new.slug is distinct from old.slug then
   new.slug_follows_name:=false;
  end if;
  v_assign:=new.slug_follows_name and (not old.slug_follows_name
   or private.business_slug_from_text(new.name) is distinct from private.business_slug_from_text(old.name));
  v_check:=not new.slug_follows_name and new.slug is distinct from old.slug;
 end if;
 if v_assign then
  v_base:=private.business_slug_from_text(new.name);
  new.slug:=private.available_business_slug(v_base,new.id);
 elsif v_check then
  perform pg_advisory_xact_lock(hashtextextended('business-slug:'||new.slug,0));
  if exists(select 1 from private.business_slug_aliases a where a.slug=new.slug and a.business_id<>new.id) then
   raise exception 'BUSINESS_SLUG_UNAVAILABLE' using errcode='23505';
  end if;
 end if;
 return new;
end $$;

-- The address a practice leaves keeps leading to it; taking back one it used before releases it
-- from the list. A column list on a trigger ignores what a BEFORE trigger changed, so this one
-- listens to the same columns as the trigger that assigns the address.
create function private.keep_previous_business_slug() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if new.slug is distinct from old.slug then
  delete from private.business_slug_aliases where slug=new.slug and business_id=new.id;
  insert into private.business_slug_aliases(slug,business_id) values(old.slug,new.id);
 end if;
 return null;
end $$;

create trigger businesses_assign_slug before insert or update of name,slug,slug_follows_name on public.businesses
 for each row execute function private.assign_business_slug();
create trigger businesses_keep_previous_slug after update of name,slug,slug_follows_name on public.businesses
 for each row execute function private.keep_previous_business_slug();
revoke all on function private.business_slug_from_text(text),private.available_business_slug(text,uuid),
 private.assign_business_slug(),private.keep_previous_business_slug() from public,anon,authenticated,service_role;

-- The practice a booking address names: its current address first, then one it used before. It
-- also finds an address typed with capitals, accents or spaces. Only the backend asks.
create function public.resolve_public_business_slug(p_reference text) returns uuid
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 with candidate(value,rank) as (
  values(p_reference,1),(lower(btrim(p_reference)),2),(private.business_slug_from_text(p_reference),3)
 )
 select found.id from (
  select b.id,c.rank,1 as source from candidate c join public.businesses b on b.slug=c.value
  union all
  select a.business_id,c.rank,2 from candidate c join private.business_slug_aliases a on a.slug=c.value
 ) found
 where length(p_reference)<=200
 order by found.source,found.rank
 limit 1
$$;
revoke all on function public.resolve_public_business_slug(text) from public,anon,authenticated;
grant execute on function public.resolve_public_business_slug(text) to service_role;

-- Both ways of creating a practice give it the address of its name. Each body is the one in force
-- (20260707165923 with the search path of 20261016012000, and 20261021080000); only the address
-- changes.
create or replace function public.ensure_user_default_business(
	p_name text default null,
	p_industry text default 'odontology'
)
returns table(business_id uuid, role text)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
	v_user_id uuid := auth.uid();
	v_email text;
	v_business_id uuid;
	v_role text;
	v_invite business_user_invites%rowtype;
	v_name text;
begin
	perform p_name, p_industry;

	if v_user_id is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select bu.business_id, bu.role
	into v_business_id, v_role
	from business_users bu
	where bu.user_id = v_user_id
		and coalesce(bu.status, 'active') = 'active'
	order by bu.created_at asc
	limit 1;

	if v_business_id is not null then
		update business_users bu
		set
			accepted_at = coalesce(bu.accepted_at, now()),
			updated_at = now()
		where bu.business_id = v_business_id
			and bu.user_id = v_user_id;

		business_id := v_business_id;
		role := v_role;
		return next;
		return;
	end if;

	select lower(u.email)
	into v_email
	from auth.users u
	where u.id = v_user_id;

	if v_email is null or v_email = '' then
		raise exception 'DEFAULT_BUSINESS_EMAIL_REQUIRED';
	end if;

	select *
	into v_invite
	from business_user_invites bui
	where lower(bui.email) = v_email
		and bui.status = 'pending'
	order by bui.created_at asc
	limit 1
	for update;

	if found then
		insert into business_users (
			business_id,
			user_id,
			role,
			status,
			accepted_at,
			created_by,
			updated_by
		)
		values (
			v_invite.business_id,
			v_user_id,
			v_invite.role,
			'active',
			now(),
			v_invite.invited_by,
			v_user_id
		)
		on conflict on constraint business_users_business_id_user_id_key
		do update set
			role = excluded.role,
			status = 'active',
			accepted_at = coalesce(business_users.accepted_at, now()),
			disabled_at = null,
			disabled_reason = null,
			updated_by = v_user_id,
			updated_at = now();

		if v_invite.role = 'professional' and v_invite.professional_id is not null then
			delete from professional_users pu
			where pu.business_id = v_invite.business_id
				and (
					(pu.user_id = v_user_id and pu.professional_id <> v_invite.professional_id)
					or (pu.professional_id = v_invite.professional_id and pu.user_id <> v_user_id)
				);

			insert into professional_users (business_id, professional_id, user_id)
			values (v_invite.business_id, v_invite.professional_id, v_user_id)
			on conflict on constraint professional_users_business_id_professional_id_user_id_key do nothing;
		else
			delete from professional_users pu
			where pu.business_id = v_invite.business_id
				and pu.user_id = v_user_id;
		end if;

		update business_user_invites bui
		set
			status = 'accepted',
			accepted_user_id = v_user_id,
			accepted_at = now(),
			updated_at = now()
		where bui.id = v_invite.id;

		business_id := v_invite.business_id;
		role := v_invite.role;
		return next;
		return;
	end if;

	-- Self-service users may create exactly one pending business. If support
	-- manually disables/removes the membership, repeated automatic creation
	-- stays blocked until an admin resolves the account.
	if exists (
		select 1
		from business_users bu
			join business_subscriptions bs on bs.business_id = bu.business_id
		where bu.user_id = v_user_id
			and bu.role = 'owner'
			and bs.is_permanent = false
			and bs.paid_until is null
			and bs.last_payment_at is null
			and bs.access_source = 'internal'
	) then
		raise exception 'DEFAULT_BUSINESS_PENDING_LIMIT_REACHED';
	end if;

	v_name := nullif(trim(coalesce(p_name, '')), '');
	if v_name is null then
		v_name := 'Consultorio';
	end if;

	-- The address comes from the name and follows it (private.assign_business_slug), never from
	-- the owner's email, which it published until 10 November 2026.
	insert into businesses (name, slug, industry, email, slug_follows_name)
	values (
		v_name,
		'consultorio',
		case
			when p_industry in ('odontology','aesthetics','kinesiology','nutrition','therapy','other')
				then p_industry
			else 'odontology'
		end,
		v_email,
		true
	)
	returning id into v_business_id;

	insert into business_users (business_id, user_id, role, status, accepted_at)
	values (v_business_id, v_user_id, 'owner', 'active', now());

	business_id := v_business_id;
	role := 'owner';
	return next;
end;
$$;

create or replace function public.create_business_with_owner(
	p_name text,
	p_slug_base text,
	p_owner_email text,
	p_duration_seconds integer,
	p_duration_unit text,
	p_is_permanent boolean,
	p_note text,
	p_access_note text,
	p_admin_id uuid,
	p_admin_email text,
	p_idempotency_key text
)
returns table (business_id uuid, owner_linked boolean)
language plpgsql
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
declare
	v_name text := nullif(btrim(coalesce(p_name, '')), '');
	v_email text := lower(btrim(coalesce(p_owner_email, '')));
	v_base text := nullif(btrim(coalesce(p_slug_base, '')), '');
	v_note text := nullif(btrim(coalesce(p_note, '')), '');
	v_owner_id uuid;
	v_business_id uuid;
	v_email_id uuid;
begin
	if v_name is null or v_base is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
		or p_admin_id is null or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
		raise exception 'BUSINESS_CREATION_INVALID' using errcode = '22023';
	end if;

	-- The same lock the association triggers take, so the owner lookup and the email row
	-- below cannot interleave with another creation or invitation for this email.
	perform pg_advisory_xact_lock(hashtextextended('business-email-association:' || v_email, 0));

	select account.id into v_owner_id
	from auth.users account
	where lower(btrim(coalesce(account.email, ''))) = v_email
	order by account.created_at
	limit 1;

	update public.allowed_emails
	set enabled = true,
		onboarding_mode = 'manual',
		disabled_at = null,
		disabled_reason = null,
		updated_by = p_admin_id,
		note = coalesce(v_note, 'Owner de consultorio creado desde panel maestro.')
	where email = v_email
	returning id into v_email_id;
	if v_email_id is null then
		insert into public.allowed_emails (email, enabled, onboarding_mode, note, updated_by, created_by)
		values (v_email, true, 'manual', coalesce(v_note, 'Owner de consultorio creado desde panel maestro.'), p_admin_id, p_admin_id);
	end if;

	-- The address comes from the name and follows it (private.assign_business_slug), which also
	-- skips an address in use, used before or shaped like an id. The base the panel sends stands in.
	insert into public.businesses (name, slug, industry, email, slug_follows_name)
	values (v_name, left(v_base, 80), 'odontology', v_email, true)
	returning id into v_business_id;

	if v_owner_id is not null then
		insert into public.business_users (business_id, user_id, role, status, accepted_at, created_by, updated_by)
		values (v_business_id, v_owner_id, 'owner', 'active', now(), p_admin_id, p_admin_id);
	else
		insert into public.business_user_invites (business_id, email, role, status, invited_by)
		values (v_business_id, v_email, 'owner', 'pending', p_admin_id);
	end if;

	perform 1
	from public.grant_business_access(
		v_business_id,
		case when coalesce(p_is_permanent, false) then 'set_permanent' else 'grant_access' end,
		p_duration_seconds,
		p_duration_unit,
		coalesce(p_is_permanent, false),
		null,
		'internal',
		p_access_note,
		p_admin_id,
		p_admin_email,
		p_idempotency_key
	);

	business_id := v_business_id;
	owner_linked := v_owner_id is not null;
	return next;
end;
$$;

-- 3. Practices whose address is still an automatic one take it from the name, oldest first, as a
-- practice created today would. Automatic means the name's own address, maybe with the six
-- characters the master panel added to a repeated one, or what self-service signup made from the
-- owner's email and the first eight characters of the account id, maybe with a counter.
do $migration$
declare v_practice record;
begin
 for v_practice in
  select b.id from public.businesses b
  where b.slug=private.business_slug_from_text(b.name)
   or b.slug~('^'||private.business_slug_from_text(b.name)||'-[0-9a-f]{6}$')
   or exists(select 1 from auth.users account
    where public.slugify_business_slug(split_part(lower(account.email),'@',1))||'-'||left(account.id::text,8)
     in (b.slug,regexp_replace(b.slug,'-[0-9]+$','')))
   or exists(select 1 from public.business_users member
    where member.business_id=b.id and b.slug~('-'||left(member.user_id::text,8)||'(-[0-9]+)?$'))
  order by b.created_at,b.id
 loop
  update public.businesses set slug_follows_name=true where id=v_practice.id;
 end loop;
end $migration$;

notify pgrst,'reload schema';
commit;
