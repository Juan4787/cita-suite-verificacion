-- The application no longer calls this legacy helper.  Keeping it callable by
-- anonymous clients would allow enumeration of the internal allow-list.
revoke all on function public.is_email_enabled(text) from public, anon, authenticated;
