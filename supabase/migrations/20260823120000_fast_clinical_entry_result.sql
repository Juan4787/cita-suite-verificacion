begin;

-- La inserción clínica ya actualiza la actividad del paciente. Este trigger
-- histórico repetía la misma escritura y emitía una revisión adicional.
drop trigger if exists clinical_entries_sync_patient on public.clinical_entries;

-- Conserva el manejo de cambios de asociación agregado para turnos y, para
-- entradas clínicas, actualiza actividad y última consulta en una sola fila.
create or replace function private.touch_patient_activity_from_domain()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_business_id uuid;
	v_patient_id uuid;
begin
	v_business_id := case when tg_op = 'DELETE' then old.business_id else new.business_id end;
	v_patient_id := case when tg_op = 'DELETE' then old.patient_id else new.patient_id end;

	if tg_op = 'UPDATE'
		and (new.business_id, new.patient_id) is distinct from (old.business_id, old.patient_id)
	then
		if old.business_id is not null and old.patient_id is not null then
			perform private.recompute_patient_activity(old.business_id, old.patient_id);
		end if;
	end if;

	if v_business_id is not null and v_patient_id is not null then
		if tg_table_name = 'clinical_entries' and tg_op in ('INSERT', 'UPDATE') then
			update public.patients patient
			set
				activity_at = greatest(
					coalesce(patient.activity_at, patient.created_at),
					statement_timestamp()
				),
				last_entry_at = greatest(
					coalesce(patient.last_entry_at, new.created_at),
					new.created_at
				)
			where patient.business_id = v_business_id
				and patient.id = v_patient_id;
		else
			update public.patients patient
			set activity_at = greatest(
				coalesce(patient.activity_at, patient.created_at),
				statement_timestamp()
			)
			where patient.business_id = v_business_id
				and patient.id = v_patient_id;
		end if;
	end if;

	return null;
end;
$$;

revoke all on function private.touch_patient_activity_from_domain() from public;

-- Devuelve exactamente la fila persistida para que la ficha pueda incorporarla
-- sin volver a consultar paciente, perfil, historial y turnos.
create or replace function public.create_clinical_entry_with_result_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_entry_type text,
	p_description text,
	p_created_at timestamptz default null,
	p_teeth text default null,
	p_internal_note text default null,
	p_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
	v_professional_id uuid;
	v_created_at timestamptz;
	v_entry public.clinical_entries%rowtype;
begin
	if v_actor is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if p_business_id is null or p_patient_id is null then
		raise exception 'INVALID_PATIENT';
	end if;
	if nullif(trim(coalesce(p_entry_type, '')), '') is null then
		raise exception 'ENTRY_TYPE_REQUIRED';
	end if;
	if nullif(trim(coalesce(p_description, '')), '') is null then
		raise exception 'DESCRIPTION_REQUIRED';
	end if;
	if not public.business_allows_operation(p_business_id) then
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;
	if not exists (
		select 1
		from public.patients patient
		where patient.business_id = p_business_id
			and patient.id = p_patient_id
	) then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	v_role := public.user_business_role(p_business_id);
	if v_role in ('owner', 'admin') then
		v_professional_id := null;
		v_created_at := coalesce(p_created_at, now());
		if v_created_at > now() + interval '5 minutes' then
			raise exception 'INVALID_CLINICAL_ENTRY_DATE';
		end if;
	elsif v_role = 'professional' then
		v_professional_id := public.current_user_professional_id(p_business_id);
		if v_professional_id is null then
			raise exception 'PROFESSIONAL_LINK_REQUIRED';
		end if;
		if not exists (
			select 1
			from public.professional_patient_links link
			where link.business_id = p_business_id
				and link.professional_id = v_professional_id
				and link.patient_id = p_patient_id
				and link.is_active = true
		) then
			raise exception 'PATIENT_ACCESS_DENIED';
		end if;
		v_created_at := now();
	else
		raise exception 'CLINICAL_ENTRY_DENIED';
	end if;

	if p_amount is not null and not public.user_can_view_costs(p_business_id) then
		raise exception 'CLINICAL_COST_DENIED';
	end if;

	insert into public.clinical_entries (
		owner_id,
		business_id,
		patient_id,
		created_at,
		entry_type,
		description,
		teeth,
		internal_note,
		created_by_user_id,
		created_by_professional_id,
		locked_after
	)
	values (
		v_actor,
		p_business_id,
		p_patient_id,
		v_created_at,
		nullif(trim(p_entry_type), ''),
		nullif(trim(p_description), ''),
		nullif(trim(coalesce(p_teeth, '')), ''),
		nullif(trim(coalesce(p_internal_note, '')), ''),
		v_actor,
		v_professional_id,
		v_created_at + interval '24 hours'
	)
	returning * into v_entry;

	if p_amount is not null then
		insert into public.clinical_entry_costs (
			business_id,
			clinical_entry_id,
			amount,
			created_by,
			updated_by
		)
		values (
			p_business_id,
			v_entry.id,
			p_amount,
			v_actor,
			v_actor
		)
		on conflict (business_id, clinical_entry_id) do update
		set
			amount = excluded.amount,
			updated_by = v_actor,
			updated_at = now();
	end if;

	return jsonb_build_object(
		'id', v_entry.id,
		'patient_id', v_entry.patient_id,
		'created_at', v_entry.created_at,
		'entry_type', v_entry.entry_type,
		'description', v_entry.description,
		'teeth', v_entry.teeth,
		'internal_note', v_entry.internal_note,
		'created_by_user_id', v_entry.created_by_user_id,
		'locked_after', v_entry.locked_after,
		'amount', p_amount
	);
end;
$$;

-- Compatibilidad hacia atrás: la versión ya desplegada sigue llamando esta
-- firma y solo consume el UUID. Delega a la operación única nueva.
create or replace function public.create_clinical_entry_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_entry_type text,
	p_description text,
	p_created_at timestamptz default null,
	p_teeth text default null,
	p_internal_note text default null,
	p_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
	v_result jsonb;
begin
	v_result := public.create_clinical_entry_with_result_safely(
		p_business_id,
		p_patient_id,
		p_entry_type,
		p_description,
		p_created_at,
		p_teeth,
		p_internal_note,
		p_amount
	);

	return nullif(v_result ->> 'id', '')::uuid;
end;
$$;

revoke all on function public.create_clinical_entry_with_result_safely(uuid, uuid, text, text, timestamptz, text, text, numeric)
	from public, anon;
grant execute on function public.create_clinical_entry_with_result_safely(uuid, uuid, text, text, timestamptz, text, text, numeric)
	to authenticated;

revoke all on function public.create_clinical_entry_safely(uuid, uuid, text, text, timestamptz, text, text, numeric)
	from public, anon;
grant execute on function public.create_clinical_entry_safely(uuid, uuid, text, text, timestamptz, text, text, numeric)
	to authenticated;

notify pgrst, 'reload schema';

commit;
