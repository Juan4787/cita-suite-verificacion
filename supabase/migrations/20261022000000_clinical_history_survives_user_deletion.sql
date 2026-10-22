-- Removing a user removed every clinical entry whose legacy owner reference named it: the only
-- clinical cascade from auth.users, while patients and documents already keep their rows and empty
-- the reference. Production never had this foreign key, and kept entries whose owner was removed.
-- The reference now becomes empty and the history remains.
begin;
alter table public.clinical_entries drop constraint clinical_entries_owner_id_fkey,
  add constraint clinical_entries_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete set null;
commit;
