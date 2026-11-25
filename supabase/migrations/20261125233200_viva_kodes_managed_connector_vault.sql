-- Private key is created on the Viva server and stored encrypted via Supabase Vault.
-- Only the authenticated site admin may call the Edge installer; only service_role
-- can call this storage procedure. Nothing is exposed to the Data API roles.
create table if not exists public.kodes_managed_server_connectors(
 id uuid primary key default gen_random_uuid(),
 public_site_id uuid not null unique,
 kodes_key_id uuid,
 public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{43}$'),
 vault_secret_id uuid not null,
 installed_by uuid not null references auth.users(id),
 installed_at timestamptz not null default now(),
 activated_at timestamptz
);
alter table public.kodes_managed_server_connectors enable row level security;
revoke all on public.kodes_managed_server_connectors from public,anon,authenticated;
create or replace function public.kodes_viva_store_managed_signing_key(
 p_site_id uuid,p_public_key text,p_private_key text,p_installed_by uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
 then raise exception 'Backend only';end if;
 if p_site_id is null or p_installed_by is null or
   p_public_key !~ '^[A-Za-z0-9_-]{43}$' or
   length(p_private_key)<60 or length(p_private_key)>500 then
   raise exception 'Invalid connector key';end if;
 if not exists(select 1 from public.user_roles where user_id=p_installed_by and role='admin')
 then raise exception 'Website administrator required';end if;
 if exists(select 1 from public.kodes_managed_server_connectors
    where public_site_id=p_site_id) then raise exception 'Connector already provisioned';end if;
 secret_id:=vault.create_secret(p_private_key,null,'Viva Mídia Kodes Connect private Ed25519 signing material',null);
 insert into public.kodes_managed_server_connectors
 (public_site_id,public_key,vault_secret_id,installed_by)
 values(p_site_id,p_public_key,secret_id,p_installed_by);
 return secret_id;
end;$$;
revoke all on function public.kodes_viva_store_managed_signing_key(uuid,text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.kodes_viva_store_managed_signing_key(uuid,text,text,uuid)
 to service_role;

create or replace function public.kodes_viva_activate_managed_connector(
 p_site_id uuid,p_key_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
 then raise exception 'Backend only'; end if;
 update public.kodes_managed_server_connectors
 set kodes_key_id=p_key_id,activated_at=now()
 where public_site_id=p_site_id and kodes_key_id is null and activated_at is null;
 if not found then raise exception 'Connector unavailable or already activated'; end if;
 return true;
end; $$;
revoke all on function public.kodes_viva_activate_managed_connector(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.kodes_viva_activate_managed_connector(uuid,uuid)
 to service_role;

-- Restricted decryption for trusted Viva server functions (metrics and comment adapter).
create or replace function public.kodes_viva_get_managed_signer(p_site_id uuid)
returns table(signing_key_id uuid,private_key_pkcs8 text)
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
 then raise exception 'Backend only';end if;
 return query
 select c.kodes_key_id,v.decrypted_secret
 from public.kodes_managed_server_connectors c
 join vault.decrypted_secrets v on v.id=c.vault_secret_id
 where c.public_site_id=p_site_id and c.activated_at is not null and c.kodes_key_id is not null;
end; $$;
revoke all on function public.kodes_viva_get_managed_signer(uuid)
 from public,anon,authenticated;
grant execute on function public.kodes_viva_get_managed_signer(uuid) to service_role;
