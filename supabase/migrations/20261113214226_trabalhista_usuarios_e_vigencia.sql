-- =====================================================================
-- Liberação de usuários pela própria aplicação e campo de vigência.
-- =====================================================================

-- Admin libera um login já existente no projeto (Authentication → Users) pelo e-mail
create or replace function trabalhista.liberar_usuario(p_email text, p_nome text, p_papel text)
returns trabalhista.usuarios
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_linha trabalhista.usuarios;
begin
  if not trabalhista.eh_admin() then
    raise exception 'Apenas administradores podem liberar usuários.';
  end if;
  if p_papel not in ('admin', 'operador', 'leitura') then
    raise exception 'Papel inválido: %', p_papel;
  end if;
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'Não existe login com o e-mail %. Crie o usuário em Authentication → Users antes de liberar.', p_email;
  end if;
  insert into trabalhista.usuarios (user_id, email, nome, papel, ativo)
  values (v_id, lower(trim(p_email)), p_nome, p_papel, true)
  on conflict (user_id) do update
    set nome = excluded.nome, papel = excluded.papel, ativo = true
  returning * into v_linha;
  return v_linha;
end $$;

revoke execute on function trabalhista.liberar_usuario(text, text, text) from public, anon;
grant execute on function trabalhista.liberar_usuario(text, text, text) to authenticated;

-- Data de início de vigência (ex.: "A partir de ..." no termo de alimentação)
insert into trabalhista.campos (chave, rotulo, tipo, obrigatorio, ordem, ajuda) values
  ('acao.data_vigencia', 'Data de início da vigência', 'data', false, 15,
   'Se ficar em branco, usa a data de admissão do colaborador')
on conflict (chave) do nothing;
