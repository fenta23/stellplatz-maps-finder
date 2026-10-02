-- Revoke EXECUTE on the SECURITY DEFINER function rls_auto_enable()
-- from the authenticated and anon roles. This function is a Supabase-managed
-- internal that should not be callable via /rest/v1/rpc/rls_auto_enable.

revoke execute on function public.rls_auto_enable() from authenticated;
revoke execute on function public.rls_auto_enable() from anon;
