-- =====================================================================
-- Gestão Trabalhista — estrutura base
-- Tudo fica no schema "trabalhista", isolado do restante do projeto.
-- Nenhuma tabela deste schema referencia tabelas do schema public.
-- =====================================================================

create schema if not exists trabalhista;
revoke all on schema trabalhista from public;
revoke all on schema trabalhista from anon;
grant usage on schema trabalhista to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Controle de acesso: só quem está nesta tabela enxerga algo do sistema
-- ---------------------------------------------------------------------
create table trabalhista.usuarios (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,              -- guardado para remapear na migração de projeto
  nome        text not null,
  papel       text not null default 'operador'
              check (papel in ('admin', 'operador', 'leitura')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
comment on table trabalhista.usuarios is
  'Quem acessa a gestão trabalhista. admin: tudo, inclusive cadastros e modelos; operador: colaboradores, ações e documentos; leitura: só consulta.';

create or replace function trabalhista.papel_atual()
returns text language sql stable security definer set search_path = '' as $$
  select u.papel from trabalhista.usuarios u
  where u.user_id = auth.uid() and u.ativo
$$;

create or replace function trabalhista.tem_acesso()
returns boolean language sql stable security definer set search_path = '' as $$
  select trabalhista.papel_atual() is not null
$$;

create or replace function trabalhista.pode_editar()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(trabalhista.papel_atual() in ('admin', 'operador'), false)
$$;

create or replace function trabalhista.eh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(trabalhista.papel_atual() = 'admin', false)
$$;

revoke execute on function trabalhista.papel_atual(), trabalhista.tem_acesso(),
  trabalhista.pode_editar(), trabalhista.eh_admin() from public, anon;
grant execute on function trabalhista.papel_atual(), trabalhista.tem_acesso(),
  trabalhista.pode_editar(), trabalhista.eh_admin() to authenticated, service_role;

-- Atualiza atualizado_em automaticamente
create or replace function trabalhista.tocar_atualizado_em()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------
create table trabalhista.empresas (
  id                 uuid primary key default gen_random_uuid(),
  razao_social       text not null,
  nome_fantasia      text,
  cnpj               text not null unique,
  inscricao_estadual text,
  endereco           text,
  numero             text,
  complemento        text,
  bairro             text,
  cidade             text,
  uf                 char(2),
  cep                text,
  telefone           text,
  email              text,
  responsavel_nome   text,
  responsavel_cpf    text,
  responsavel_cargo  text,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create table trabalhista.funcoes (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null unique,
  cbo            text,
  descricao      text,
  jornada        text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Tipos de evento que geram documentos (admissão, férias, demissão...)
create table trabalhista.tipos_acao (
  codigo   text primary key check (codigo ~ '^[a-z0-9_]+$'),
  nome     text not null,
  etapa    text not null check (etapa in ('admissao', 'gestao', 'demissao')),
  ordem    int not null default 0,
  ativo    boolean not null default true
);

-- Documento-base (o "modelo"); o arquivo .docx fica nas versões
create table trabalhista.documentos_modelo (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null unique,
  descricao         text,
  tipo_acao         text not null references trabalhista.tipos_acao(codigo),
  exige_assinatura  boolean not null default true,
  validade_meses    int check (validade_meses is null or validade_meses > 0),
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
comment on column trabalhista.documentos_modelo.validade_meses is
  'Preencher quando o documento vence e precisa ser refeito (ex.: ASO). Nulo = não vence.';

create table trabalhista.documentos_modelo_versoes (
  id                uuid primary key default gen_random_uuid(),
  modelo_id         uuid not null references trabalhista.documentos_modelo(id),
  versao            int not null check (versao > 0),
  arquivo_path      text not null,         -- caminho no bucket "trabalhista"
  nome_arquivo      text,
  marcadores        text[] not null default '{}',  -- marcadores encontrados no .docx
  observacao        text,
  ativa             boolean not null default false,
  criado_por        uuid default auth.uid(),
  criado_por_email  text default (auth.jwt() ->> 'email'),
  criado_em         timestamptz not null default now(),
  unique (modelo_id, versao)
);
create unique index documentos_modelo_versoes_uma_ativa
  on trabalhista.documentos_modelo_versoes (modelo_id) where ativa;

-- Kit de documentos de cada função
create table trabalhista.funcao_documentos (
  funcao_id    uuid not null references trabalhista.funcoes(id) on delete cascade,
  modelo_id    uuid not null references trabalhista.documentos_modelo(id) on delete cascade,
  obrigatorio  boolean not null default true,
  ordem        int not null default 0,
  -- Documento condicional: só entra no kit quando acoes.dados[condicao_campo] = condicao_valor
  -- (ex.: contrato de experiência x indeterminado; opção x não opção ao plano de saúde)
  condicao_campo  text check (condicao_campo is null or condicao_campo ~ '^acao\.[a-z0-9_]+$'),
  condicao_valor  text,
  check ((condicao_campo is null) = (condicao_valor is null)),
  primary key (funcao_id, modelo_id)
);

-- Dicionário de campos: cada marcador {grupo.nome} usado nos documentos-base
create table trabalhista.campos (
  chave          text primary key
                 check (chave ~ '^(colaborador|funcao|empresa|acao)\.[a-z0-9_]+$'),
  grupo          text generated always as (split_part(chave, '.', 1)) stored,
  rotulo         text not null,
  tipo           text not null default 'texto'
                 check (tipo in ('texto', 'texto_longo', 'data', 'moeda', 'numero',
                                 'inteiro', 'cpf', 'cnpj', 'cep', 'telefone', 'email',
                                 'lista', 'sim_nao')),
  opcoes         jsonb,             -- valores possíveis quando tipo = 'lista'
  coluna_origem  text,              -- coluna da tabela do grupo; nulo = guardado em dados_extras / acoes.dados
  obrigatorio    boolean not null default false,
  ordem          int not null default 0,
  ajuda          text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
comment on table trabalhista.campos is
  'Marcadores disponíveis para os documentos-base. Ex.: {colaborador.nome}, {acao.data_admissao}.';

-- ---------------------------------------------------------------------
-- Colaboradores, ações e documentos gerados
-- ---------------------------------------------------------------------
create table trabalhista.colaboradores (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references trabalhista.empresas(id),
  funcao_id          uuid references trabalhista.funcoes(id),
  situacao           text not null default 'em_admissao'
                     check (situacao in ('em_admissao', 'ativo', 'afastado', 'desligado')),
  nome               text not null,
  cpf                text not null unique,
  rg                 text,
  rg_orgao           text,
  rg_emissao         date,
  data_nascimento    date,
  naturalidade       text,
  nacionalidade      text default 'Brasileira',
  estado_civil       text,
  sexo               text,
  nome_mae           text,
  nome_pai           text,
  pis                text,
  ctps_numero        text,
  ctps_serie         text,
  ctps_uf            char(2),
  titulo_eleitor     text,
  cnh_numero         text,
  cnh_categoria      text,
  cnh_validade       date,
  email              text,
  telefone           text,
  endereco           text,
  numero             text,
  complemento        text,
  bairro             text,
  cidade             text,
  uf                 char(2),
  cep                text,
  banco              text,
  agencia            text,
  conta              text,
  pix                text,
  data_admissao      date,
  data_desligamento  date,
  salario            numeric(12, 2),
  dados_extras       jsonb not null default '{}',   -- campos do dicionário sem coluna própria
  criado_por         uuid default auth.uid(),
  criado_por_email   text default (auth.jwt() ->> 'email'),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index colaboradores_funcao_idx on trabalhista.colaboradores (funcao_id);
create index colaboradores_empresa_idx on trabalhista.colaboradores (empresa_id);

-- Cada evento na vida do colaborador (admissão, advertência, férias, demissão...)
create table trabalhista.acoes (
  id                uuid primary key default gen_random_uuid(),
  colaborador_id    uuid not null references trabalhista.colaboradores(id),
  tipo_acao         text not null references trabalhista.tipos_acao(codigo),
  funcao_id         uuid references trabalhista.funcoes(id),   -- função no momento da ação
  data_acao         date not null default current_date,
  dados             jsonb not null default '{}',   -- valores dos campos acao.*
  snapshot          jsonb,                          -- foto de todos os valores usados na geração
  status            text not null default 'rascunho'
                    check (status in ('rascunho', 'gerada', 'concluida', 'cancelada')),
  observacao        text,
  criado_por        uuid default auth.uid(),
  criado_por_email  text default (auth.jwt() ->> 'email'),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index acoes_colaborador_idx on trabalhista.acoes (colaborador_id);

create table trabalhista.documentos_gerados (
  id                     uuid primary key default gen_random_uuid(),
  acao_id                uuid not null references trabalhista.acoes(id),
  colaborador_id         uuid not null references trabalhista.colaboradores(id),
  modelo_id              uuid not null references trabalhista.documentos_modelo(id),
  versao_id              uuid not null references trabalhista.documentos_modelo_versoes(id),
  obrigatorio            boolean not null default true,
  status                 text not null default 'gerado'
                         check (status in ('gerado', 'aguardando_assinatura', 'assinado',
                                           'conferido', 'rejeitado', 'dispensado')),
  arquivo_gerado_path    text,
  gerado_em              timestamptz not null default now(),
  gerado_por             uuid default auth.uid(),
  gerado_por_email       text default (auth.jwt() ->> 'email'),
  arquivo_assinado_path  text,
  assinado_enviado_em    timestamptz,
  assinado_enviado_por   uuid,
  assinado_enviado_por_email text,
  conferido_em           timestamptz,
  conferido_por          uuid,
  conferido_por_email    text,
  motivo_rejeicao        text,
  motivo_dispensa        text,
  validade_ate           date,
  atualizado_em          timestamptz not null default now(),
  unique (acao_id, modelo_id)
);
create index documentos_gerados_colaborador_idx on trabalhista.documentos_gerados (colaborador_id);
create index documentos_gerados_status_idx on trabalhista.documentos_gerados (status);
create index documentos_gerados_modelo_idx on trabalhista.documentos_gerados (modelo_id);
create index documentos_gerados_versao_idx on trabalhista.documentos_gerados (versao_id);
create index acoes_funcao_idx on trabalhista.acoes (funcao_id);
create index acoes_tipo_idx on trabalhista.acoes (tipo_acao);
create index documentos_modelo_tipo_idx on trabalhista.documentos_modelo (tipo_acao);
create index funcao_documentos_modelo_idx on trabalhista.funcao_documentos (modelo_id);

-- ---------------------------------------------------------------------
-- Histórico (auditoria) de tudo que muda
-- ---------------------------------------------------------------------
create table trabalhista.historico (
  id             bigint generated always as identity primary key,
  tabela         text not null,
  registro_id    text,
  operacao       text not null,
  antes          jsonb,
  depois         jsonb,
  usuario_id     uuid default auth.uid(),
  usuario_email  text default (auth.jwt() ->> 'email'),
  em             timestamptz not null default now()
);
create index historico_registro_idx on trabalhista.historico (tabela, registro_id);

create or replace function trabalhista.registrar_historico()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_antes  jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into trabalhista.historico (tabela, registro_id, operacao, antes, depois)
  values (tg_table_name,
          coalesce(v_depois, v_antes) ->> coalesce(tg_argv[0], 'id'),
          tg_op, v_antes, v_depois);
  return coalesce(new, old);
end $$;
revoke execute on function trabalhista.registrar_historico() from public, anon, authenticated;

-- Triggers de atualizado_em e histórico
do $$
declare t text;
begin
  foreach t in array array['empresas', 'funcoes', 'documentos_modelo', 'campos',
                           'colaboradores', 'acoes', 'documentos_gerados'] loop
    execute format('create trigger tocar_atualizado_em before update on trabalhista.%I
                    for each row execute function trabalhista.tocar_atualizado_em()', t);
  end loop;

  foreach t in array array['empresas', 'funcoes', 'documentos_modelo', 'documentos_modelo_versoes',
                           'colaboradores', 'acoes', 'documentos_gerados'] loop
    execute format('create trigger historico after insert or update or delete on trabalhista.%I
                    for each row execute function trabalhista.registrar_historico()', t);
  end loop;
end $$;

create trigger historico after insert or update or delete on trabalhista.campos
  for each row execute function trabalhista.registrar_historico('chave');
create trigger historico after insert or update or delete on trabalhista.funcao_documentos
  for each row execute function trabalhista.registrar_historico('funcao_id');
create trigger historico after insert or update or delete on trabalhista.usuarios
  for each row execute function trabalhista.registrar_historico('user_id');

-- ---------------------------------------------------------------------
-- Painel de conformidade
-- ---------------------------------------------------------------------
create view trabalhista.painel_conformidade
with (security_invoker = true) as
select
  c.id                         as colaborador_id,
  c.nome,
  c.cpf,
  c.situacao,
  f.nome                       as funcao,
  c.data_admissao,
  count(d.id)                                                          as documentos_total,
  count(d.id) filter (where d.obrigatorio and d.status in ('gerado', 'aguardando_assinatura', 'rejeitado'))
                                                                       as pendentes_assinatura,
  count(d.id) filter (where d.status = 'assinado')                     as aguardando_conferencia,
  count(d.id) filter (where d.status = 'conferido')                    as conferidos,
  count(d.id) filter (where d.status = 'rejeitado')                    as rejeitados,
  count(d.id) filter (where d.validade_ate < current_date and d.status <> 'dispensado')
                                                                       as vencidos,
  min(d.validade_ate) filter (where d.validade_ate >= current_date)    as proximo_vencimento,
  (select count(*)
     from trabalhista.funcao_documentos fd
     join trabalhista.documentos_modelo m on m.id = fd.modelo_id
     join trabalhista.tipos_acao ta on ta.codigo = m.tipo_acao
    where fd.funcao_id = c.funcao_id and fd.obrigatorio and m.ativo
      and fd.condicao_campo is null
      and ta.etapa = 'admissao'
      and not exists (select 1 from trabalhista.documentos_gerados g
                       where g.colaborador_id = c.id and g.modelo_id = m.id
                         and g.status <> 'dispensado'))                as admissao_nao_gerados
from trabalhista.colaboradores c
left join trabalhista.funcoes f on f.id = c.funcao_id
left join trabalhista.documentos_gerados d on d.colaborador_id = c.id
group by c.id, f.nome;

-- ---------------------------------------------------------------------
-- Permissões e RLS
-- ---------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema trabalhista to authenticated;
grant usage, select on all sequences in schema trabalhista to authenticated;
grant all on all tables in schema trabalhista to service_role;
grant all on all sequences in schema trabalhista to service_role;

alter table trabalhista.usuarios                  enable row level security;
alter table trabalhista.empresas                  enable row level security;
alter table trabalhista.funcoes                   enable row level security;
alter table trabalhista.tipos_acao                enable row level security;
alter table trabalhista.documentos_modelo         enable row level security;
alter table trabalhista.documentos_modelo_versoes enable row level security;
alter table trabalhista.funcao_documentos         enable row level security;
alter table trabalhista.campos                    enable row level security;
alter table trabalhista.colaboradores             enable row level security;
alter table trabalhista.acoes                     enable row level security;
alter table trabalhista.documentos_gerados        enable row level security;
alter table trabalhista.historico                 enable row level security;

-- usuarios: cada um vê o próprio registro; admin vê e gerencia todos
create policy usuarios_select on trabalhista.usuarios for select to authenticated
  using (user_id = (select auth.uid()) or (select trabalhista.eh_admin()));
create policy usuarios_insert on trabalhista.usuarios for insert to authenticated
  with check ((select trabalhista.eh_admin()));
create policy usuarios_update on trabalhista.usuarios for update to authenticated
  using ((select trabalhista.eh_admin())) with check ((select trabalhista.eh_admin()));
create policy usuarios_delete on trabalhista.usuarios for delete to authenticated
  using ((select trabalhista.eh_admin()));

-- Cadastros: todos com acesso leem; só admin altera
do $$
declare t text;
begin
  foreach t in array array['empresas', 'funcoes', 'tipos_acao', 'documentos_modelo',
                           'documentos_modelo_versoes', 'funcao_documentos', 'campos'] loop
    execute format('create policy %1$s_select on trabalhista.%1$I for select to authenticated
                    using ((select trabalhista.tem_acesso()))', t);
    execute format('create policy %1$s_insert on trabalhista.%1$I for insert to authenticated
                    with check ((select trabalhista.eh_admin()))', t);
    execute format('create policy %1$s_update on trabalhista.%1$I for update to authenticated
                    using ((select trabalhista.eh_admin())) with check ((select trabalhista.eh_admin()))', t);
  end loop;
end $$;

-- Exclusão só onde faz sentido (montagem de kit e dicionário); o resto se inativa
create policy funcao_documentos_delete on trabalhista.funcao_documentos for delete to authenticated
  using ((select trabalhista.eh_admin()));
create policy campos_delete on trabalhista.campos for delete to authenticated
  using ((select trabalhista.eh_admin()));

-- Operação: admin e operador incluem e alteram; ninguém exclui (cancela/dispensa)
do $$
declare t text;
begin
  foreach t in array array['colaboradores', 'acoes', 'documentos_gerados'] loop
    execute format('create policy %1$s_select on trabalhista.%1$I for select to authenticated
                    using ((select trabalhista.tem_acesso()))', t);
    execute format('create policy %1$s_insert on trabalhista.%1$I for insert to authenticated
                    with check ((select trabalhista.pode_editar()))', t);
    execute format('create policy %1$s_update on trabalhista.%1$I for update to authenticated
                    using ((select trabalhista.pode_editar())) with check ((select trabalhista.pode_editar()))', t);
  end loop;
end $$;

-- Histórico: só admin consulta; gravação apenas pelos triggers
create policy historico_select on trabalhista.historico for select to authenticated
  using ((select trabalhista.eh_admin()));

-- Novas tabelas criadas no futuro neste schema não ficam abertas por padrão
alter default privileges in schema trabalhista revoke all on tables from anon, public;
