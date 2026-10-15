-- Seguimientos (follow-ups): recordar volver a contactar a un paciente, sin turno necesariamente.
-- Sin recurrencia: cada seguimiento es único; al marcarse 'done' termina y no reaparece.
-- Visibilidad por rol de sistema (server-side); asignación a un perfil profesional atendible.

create table if not exists public.follow_ups (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses(id) on delete cascade,
	patient_id uuid not null references public.patients(id) on delete cascade,
	-- restrict: un profesional con seguimientos (pending o done) no se borra, se archiva (preserva historial).
	assigned_professional_id uuid references public.professionals(id) on delete restrict,
	remind_on date not null,
	message text,
	status text not null default 'pending' check (status in ('pending', 'done')),
	created_by uuid,                 -- auth user id (auditoría; nunca se muestra en UI)
	done_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists follow_ups_business_status_remind_idx
	on public.follow_ups (business_id, status, remind_on);
create index if not exists follow_ups_business_prof_status_remind_idx
	on public.follow_ups (business_id, assigned_professional_id, status, remind_on);
create index if not exists follow_ups_patient_idx
	on public.follow_ups (patient_id);

-- updated_at automático (reutiliza el helper existente del módulo)
drop trigger if exists trg_follow_ups_updated_at on public.follow_ups;
create trigger trg_follow_ups_updated_at
	before update on public.follow_ups
	for each row
	execute function public.touch_updated_at();

-- RLS: aísla por negocio (defensa secundaria; el scope por rol se hace server-side con admin client).
alter table public.follow_ups enable row level security;

do $$
begin
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'follow_ups' and policyname = 'follow_ups_select') then
		create policy follow_ups_select on public.follow_ups
			for select to authenticated
			using (public.user_has_business_access(business_id));
	end if;
	if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'follow_ups' and policyname = 'follow_ups_write') then
		create policy follow_ups_write on public.follow_ups
			for all to authenticated
			using (public.user_has_business_access(business_id))
			with check (public.user_has_business_access(business_id));
	end if;
end $$;

grant select, insert, update, delete on public.follow_ups to authenticated;
