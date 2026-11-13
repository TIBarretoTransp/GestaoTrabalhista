-- Painel: acrescenta a contagem de documentos dispensados (para o progresso por colaborador)
create or replace view trabalhista.painel_conformidade
with (security_invoker = true) as
select
  c.id as colaborador_id, c.nome, c.cpf, c.situacao, f.nome as funcao, c.data_admissao,
  count(d.id) as documentos_total,
  count(d.id) filter (where d.obrigatorio and d.status in ('gerado', 'aguardando_assinatura', 'rejeitado')) as pendentes_assinatura,
  count(d.id) filter (where d.status = 'assinado') as aguardando_conferencia,
  count(d.id) filter (where d.status = 'conferido') as conferidos,
  count(d.id) filter (where d.status = 'rejeitado') as rejeitados,
  count(d.id) filter (where d.validade_ate < current_date and d.status <> 'dispensado') as vencidos,
  min(d.validade_ate) filter (where d.validade_ate >= current_date) as proximo_vencimento,
  (select count(*)
     from trabalhista.funcao_documentos fd
     join trabalhista.documentos_modelo m on m.id = fd.modelo_id
     join trabalhista.tipos_acao ta on ta.codigo = fd.tipo_acao
    where fd.funcao_id = c.funcao_id and fd.obrigatorio and m.ativo
      and fd.condicao_campo is null and ta.etapa = 'admissao'
      and not exists (select 1 from trabalhista.documentos_gerados g
                       where g.colaborador_id = c.id and g.modelo_id = m.id and g.status <> 'dispensado')) as admissao_nao_gerados,
  count(d.id) filter (where d.status = 'dispensado') as dispensados
from trabalhista.colaboradores c
left join trabalhista.funcoes f on f.id = c.funcao_id
left join trabalhista.documentos_gerados d on d.colaborador_id = c.id
group by c.id, f.nome;
