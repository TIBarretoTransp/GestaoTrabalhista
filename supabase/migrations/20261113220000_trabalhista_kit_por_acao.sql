-- =====================================================================
-- Kit passa a ser definido por função + tipo de ação.
-- Motivo: o mesmo documento-base aparece em mais de um evento
-- (ex.: a Política de Benefícios entra na admissão e na transferência).
-- Também marca campos calculados (montados pela aplicação, sem digitação).
-- =====================================================================

drop view trabalhista.painel_conformidade;

alter table trabalhista.funcao_documentos drop constraint funcao_documentos_pkey;
alter table trabalhista.funcao_documentos
  add column tipo_acao text references trabalhista.tipos_acao(codigo);
update trabalhista.funcao_documentos fd
   set tipo_acao = m.tipo_acao
  from trabalhista.documentos_modelo m where m.id = fd.modelo_id;
alter table trabalhista.funcao_documentos alter column tipo_acao set not null;
alter table trabalhista.funcao_documentos
  add primary key (funcao_id, tipo_acao, modelo_id);
create index funcao_documentos_tipo_idx on trabalhista.funcao_documentos (tipo_acao);

drop index trabalhista.documentos_modelo_tipo_idx;
alter table trabalhista.documentos_modelo drop column tipo_acao;
alter table trabalhista.documentos_modelo
  add column categoria text not null default 'admissao'
  check (categoria in ('admissao', 'gestao', 'demissao'));
comment on column trabalhista.documentos_modelo.categoria is
  'Só para organizar a lista de documentos-base; o uso real é definido nos kits (funcao_documentos).';

alter table trabalhista.campos add column calculado boolean not null default false;
comment on column trabalhista.campos.calculado is
  'Valor montado pela aplicação a partir de outros campos (ex.: endereço completo). Não aparece no formulário.';

-- Painel recriado considerando o kit de admissão (função + tipo de ação de etapa admissão)
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
     join trabalhista.tipos_acao ta on ta.codigo = fd.tipo_acao
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

grant select on trabalhista.painel_conformidade to authenticated;
