-- Executar no SQL Editor do Supabase (projeto barreto-manutencao), de uma vez.
-- Conteúdo: migrações 20261113220000 (kit por ação) + 20261113220100 (dados iniciais).
begin;
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

-- =====================================================================
-- Dados iniciais: empresas, funções, tipos de ação, dicionário de campos,
-- catálogo de documentos-base e kits.
-- Kits montados a partir dos recibos de entrega enviados (16 e 10/11).
-- Tudo pode ser ajustado depois pela tela de cadastros.
-- =====================================================================

-- Empresas ------------------------------------------------------------
insert into trabalhista.empresas
  (razao_social, cnpj, endereco, numero, bairro, cidade, uf, ativo)
values
  ('BARRETO TRANSPORTES DE ITAPEVA LTDA', '07.020.033/0001-42',
   'Rua Itaporanga', '144', 'Vila Bom Jesus', 'Itapeva', 'SP', true),
  ('ANTONIO EZIQUEL BARRETO ME', '19.278.023/0001-90',
   'Rua Itaporanga', '144', 'Vila Bom Jesus', 'Itapeva', 'SP', false)  -- empregadora de origem na transferência
on conflict (cnpj) do nothing;

-- Funções -------------------------------------------------------------
insert into trabalhista.funcoes (nome, descricao) values
  ('Motorista Carreteiro', 'Condução de veículos de carga e atividades acessórias do transporte'),
  ('Administrativo', 'Pessoal administrativo (ajustar o nome conforme o cargo)')
on conflict (nome) do nothing;

-- Tipos de ação -------------------------------------------------------
insert into trabalhista.tipos_acao (codigo, nome, etapa, ordem) values
  ('admissao',                  'Admissão',                                   'admissao', 10),
  ('transferencia_grupo',       'Transferência entre empresas do grupo',      'gestao',   20),
  ('banco_horas',               'Acordo de banco de horas',                   'gestao',   30),
  ('beneficiarios_seguro',      'Indicação de beneficiários do seguro de vida','gestao',  40),
  ('premiacao_mensal',          'Demonstrativo mensal da premiação',          'gestao',   50),
  ('conferencia_demonstrativo', 'Conferência do demonstrativo',               'gestao',   60),
  ('sindicancia',               'Sindicância de acidente ou avaria',          'gestao',   70),
  ('demissao',                  'Demissão',                                   'demissao', 90)
on conflict (codigo) do nothing;

-- Dicionário de campos ------------------------------------------------
-- Formatação na hora de gerar: {campo|moeda}, {campo|extenso}, {campo|data},
-- {campo|data_extenso}, {campo|dia}, {campo|mes_extenso}, {campo|ano}, {campo|maiusculas}
insert into trabalhista.campos (chave, rotulo, tipo, coluna_origem, obrigatorio, ordem, calculado, ajuda, opcoes) values
  -- colaborador
  ('colaborador.nome',              'Nome completo',            'texto',   'nome',            true,  10, false, null, null),
  ('colaborador.cpf',               'CPF',                      'cpf',     'cpf',             true,  20, false, null, null),
  ('colaborador.rg',                'RG',                       'texto',   'rg',              true,  30, false, null, null),
  ('colaborador.rg_orgao',          'Órgão expedidor do RG',    'texto',   'rg_orgao',        true,  40, false, null, null),
  ('colaborador.data_nascimento',   'Data de nascimento',       'data',    'data_nascimento', true,  50, false, null, null),
  ('colaborador.estado_civil',      'Estado civil',             'lista',   'estado_civil',    false, 60, false, null,
     '["Solteiro(a)","Casado(a)","União estável","Divorciado(a)","Viúvo(a)"]'),
  ('colaborador.nacionalidade',     'Nacionalidade',            'texto',   'nacionalidade',   false, 70, false, null, null),
  ('colaborador.pis',               'PIS',                      'texto',   'pis',             false, 80, false, null, null),
  ('colaborador.ctps_numero',       'CTPS — número',            'texto',   'ctps_numero',     false, 90, false, null, null),
  ('colaborador.ctps_serie',        'CTPS — série',             'texto',   'ctps_serie',      false, 100, false, null, null),
  ('colaborador.cnh_numero',        'CNH — número',             'texto',   'cnh_numero',      false, 110, false, null, null),
  ('colaborador.cnh_categoria',     'CNH — categoria',          'texto',   'cnh_categoria',   false, 120, false, null, null),
  ('colaborador.cnh_validade',      'CNH — validade',           'data',    'cnh_validade',    false, 130, false, null, null),
  ('colaborador.telefone',          'Telefone',                 'telefone','telefone',        true,  140, false, null, null),
  ('colaborador.email',             'E-mail',                   'email',   'email',           false, 150, false, null, null),
  ('colaborador.endereco',          'Logradouro',               'texto',   'endereco',        true,  160, false, null, null),
  ('colaborador.numero',            'Número',                   'texto',   'numero',          true,  170, false, null, null),
  ('colaborador.complemento',       'Complemento',              'texto',   'complemento',     false, 180, false, null, null),
  ('colaborador.bairro',            'Bairro',                   'texto',   'bairro',          true,  190, false, null, null),
  ('colaborador.cidade',            'Cidade',                   'texto',   'cidade',          true,  200, false, null, null),
  ('colaborador.uf',                'UF',                       'texto',   'uf',              true,  210, false, null, null),
  ('colaborador.cep',               'CEP',                      'cep',     'cep',             true,  220, false, null, null),
  ('colaborador.endereco_completo', 'Endereço completo',        'texto',   null,              false, 230, true,
     'Montado a partir de logradouro, número, complemento, bairro, cidade/UF e CEP', null),
  ('colaborador.data_admissao',     'Data de admissão',         'data',    'data_admissao',   true,  240, false, null, null),
  ('colaborador.salario',           'Salário-base mensal',      'moeda',   'salario',         true,  250, false, null, null),
  -- empresa
  ('empresa.razao_social',          'Razão social',             'texto',   'razao_social',    true,  10, false, null, null),
  ('empresa.cnpj',                  'CNPJ',                     'cnpj',    'cnpj',            true,  20, false, null, null),
  ('empresa.cidade',                'Cidade da empresa',        'texto',   'cidade',          true,  30, false, null, null),
  ('empresa.uf',                    'UF da empresa',            'texto',   'uf',              true,  40, false, null, null),
  ('empresa.endereco_completo',     'Endereço da empresa',      'texto',   null,              false, 50, true,
     'Montado a partir do cadastro da empresa', null),
  -- função
  ('funcao.nome',                   'Função',                   'texto',   'nome',            true,  10, false, null, null),
  ('funcao.cbo',                    'CBO',                      'texto',   'cbo',             false, 20, false, null, null),
  -- ação (preenchidos a cada evento)
  ('acao.data_documento',           'Data dos documentos',      'data',    null,              true,  10, false,
     'Data que aparece em "Itapeva/SP, __ de ____ de ____"', null),
  ('acao.modalidade_contrato',      'Modalidade do contrato',   'lista',   null,              true,  20, false, null,
     '["indeterminado","experiencia"]'),
  ('acao.experiencia_inicio',       'Experiência — início',     'data',    null,              false, 30, false, null, null),
  ('acao.experiencia_fim',          'Experiência — fim',        'data',    null,              false, 40, false, null, null),
  ('acao.experiencia_dias',         'Experiência — total de dias','inteiro',null,             false, 50, false, null, null),
  ('acao.jornada_horas_diarias',    'Jornada — horas diárias',  'numero',  null,              true,  60, false, null, null),
  ('acao.jornada_horas_semanais',   'Jornada — horas semanais', 'numero',  null,              true,  70, false, null, null),
  ('acao.escala_horario',           'Escala / horário de referência','texto',null,            false, 80, false, null, null),
  ('acao.plano_saude',              'Plano de saúde',           'lista',   null,              true,  90, false, null,
     '["opta","nao_opta"]'),
  ('acao.data_transferencia',       'Data da transferência',    'data',    null,              false, 100, false, null, null)
on conflict (chave) do nothing;

-- Catálogo de documentos-base (só documentos individuais, por colaborador)
insert into trabalhista.documentos_modelo (nome, categoria, exige_assinatura, descricao) values
  -- admissão direta
  ('Contrato Individual de Trabalho — Motorista Carreteiro (prazo indeterminado)', 'admissao', true, 'Arquivo 12'),
  ('Contrato Individual de Trabalho — Motorista Carreteiro (experiência)',        'admissao', true, 'Arquivo 12b'),
  ('Termo Individual de Ciência e Implantação — admissão direta',                 'admissao', true, 'Arquivo 15'),
  ('Termo de Ciência sobre Tratamento de Dados (LGPD)',                           'admissao', true, 'Arquivos 09 / 13'),
  ('Aditivo de Proteção de Dados e Telemetria',                                   'admissao', true, 'Arquivos 02 (pacote 4) / 14'),
  ('Recibo de Entrega de Documentos — Motorista, admissão direta',                'admissao', true, 'Arquivo 16'),
  ('Política Interna de Benefícios e Reconhecimento',                             'admissao', false,'Arquivo 04 — entregue, sem assinatura própria (consta no recibo)'),
  ('Termo Individual de Alimentação em Cartão',                                   'admissao', true, 'Arquivo 06'),
  ('Regulamento do Plano de Saúde',                                               'admissao', true, 'Arquivo 07 — ciente do empregado'),
  ('Termo Individual de Opção e Adesão ao Plano de Saúde',                        'admissao', true, 'Arquivo 08'),
  ('Termo de Não Opção ao Plano de Saúde',                                        'admissao', true, 'Arquivo 08b'),
  -- gestão
  ('Acordo Individual de Banco de Horas',                                         'gestao',   true, 'Arquivo 01 (pacote 4)'),
  ('Formulário de Indicação de Beneficiários do Seguro de Vida',                  'gestao',   true, 'Arquivo 09 (pacote 4)'),
  ('Demonstrativo Mensal da Premiação',                                           'gestao',   true, 'Arquivo 05 (pacote 4) — recebido pelo motorista'),
  ('Formulário de Conferência do Demonstrativo',                                  'gestao',   true, 'Arquivo 06 (pacote 4)'),
  ('Rito de Sindicância de Acidente ou Avaria',                                   'gestao',   true, 'Arquivo 07 (pacote 4)'),
  -- transferência entre empresas do grupo (setembro/2026)
  ('Termo Aditivo de Transferência — Motoristas',                                 'gestao',   true, 'Arquivo 01 (pacote 3)'),
  ('Termo Aditivo de Transferência — Administrativo',                             'gestao',   true, 'Arquivo 02 (pacote 3)'),
  ('Termo Aditivo da Estrutura Salarial',                                         'gestao',   true, 'Arquivo 03 (pacote 3)'),
  ('Termo Individual de Ciência e Implantação — transferência',                   'gestao',   true, 'Arquivo 05 (pacote 3)'),
  ('Recibo de Entrega de Documentos — Motoristas, transferência',                 'gestao',   true, 'Arquivo 10 (pacote 3)'),
  ('Recibo de Entrega de Documentos e Ciência — Administrativo, transferência',   'gestao',   true, 'Arquivo 11 (pacote 3)')
on conflict (nome) do nothing;

-- Kits ----------------------------------------------------------------
with k (funcao, tipo_acao, documento, obrigatorio, ordem, cond_campo, cond_valor) as (values
  -- Motorista Carreteiro: admissão direta (recibo 16)
  ('Motorista Carreteiro', 'admissao', 'Contrato Individual de Trabalho — Motorista Carreteiro (prazo indeterminado)', true, 10, 'acao.modalidade_contrato', 'indeterminado'),
  ('Motorista Carreteiro', 'admissao', 'Contrato Individual de Trabalho — Motorista Carreteiro (experiência)',        true, 10, 'acao.modalidade_contrato', 'experiencia'),
  ('Motorista Carreteiro', 'admissao', 'Política Interna de Benefícios e Reconhecimento',                             true, 20, null, null),
  ('Motorista Carreteiro', 'admissao', 'Termo Individual de Ciência e Implantação — admissão direta',                 true, 30, null, null),
  ('Motorista Carreteiro', 'admissao', 'Termo Individual de Alimentação em Cartão',                                   true, 40, null, null),
  ('Motorista Carreteiro', 'admissao', 'Regulamento do Plano de Saúde',                                               true, 50, null, null),
  ('Motorista Carreteiro', 'admissao', 'Termo Individual de Opção e Adesão ao Plano de Saúde',                        true, 60, 'acao.plano_saude', 'opta'),
  ('Motorista Carreteiro', 'admissao', 'Termo de Não Opção ao Plano de Saúde',                                        true, 60, 'acao.plano_saude', 'nao_opta'),
  ('Motorista Carreteiro', 'admissao', 'Termo de Ciência sobre Tratamento de Dados (LGPD)',                           true, 70, null, null),
  ('Motorista Carreteiro', 'admissao', 'Aditivo de Proteção de Dados e Telemetria',                                   true, 80, null, null),
  ('Motorista Carreteiro', 'admissao', 'Acordo Individual de Banco de Horas',                                         false, 90, null, null),
  ('Motorista Carreteiro', 'admissao', 'Formulário de Indicação de Beneficiários do Seguro de Vida',                  false, 95, null, null),
  ('Motorista Carreteiro', 'admissao', 'Recibo de Entrega de Documentos — Motorista, admissão direta',                true, 99, null, null),
  -- Motorista Carreteiro: eventos de gestão
  ('Motorista Carreteiro', 'banco_horas',               'Acordo Individual de Banco de Horas',                        true, 10, null, null),
  ('Motorista Carreteiro', 'beneficiarios_seguro',      'Formulário de Indicação de Beneficiários do Seguro de Vida', true, 10, null, null),
  ('Motorista Carreteiro', 'premiacao_mensal',          'Demonstrativo Mensal da Premiação',                          true, 10, null, null),
  ('Motorista Carreteiro', 'conferencia_demonstrativo', 'Formulário de Conferência do Demonstrativo',                 true, 10, null, null),
  ('Motorista Carreteiro', 'sindicancia',               'Rito de Sindicância de Acidente ou Avaria',                  true, 10, null, null),
  -- Motorista Carreteiro: transferência (recibo 10)
  ('Motorista Carreteiro', 'transferencia_grupo', 'Termo Aditivo de Transferência — Motoristas',                      true, 10, null, null),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Termo Aditivo da Estrutura Salarial',                              true, 20, null, null),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Política Interna de Benefícios e Reconhecimento',                  true, 30, null, null),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Termo Individual de Ciência e Implantação — transferência',        true, 40, null, null),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Termo Individual de Alimentação em Cartão',                        true, 50, null, null),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Regulamento do Plano de Saúde',                                    true, 60, null, null),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Termo Individual de Opção e Adesão ao Plano de Saúde',             true, 70, 'acao.plano_saude', 'opta'),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Termo de Não Opção ao Plano de Saúde',                             true, 70, 'acao.plano_saude', 'nao_opta'),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Termo de Ciência sobre Tratamento de Dados (LGPD)',                true, 80, null, null),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Aditivo de Proteção de Dados e Telemetria',                        true, 90, null, null),
  ('Motorista Carreteiro', 'transferencia_grupo', 'Recibo de Entrega de Documentos — Motoristas, transferência',      true, 99, null, null),
  -- Administrativo: transferência (recibo 11)
  ('Administrativo', 'transferencia_grupo', 'Termo Aditivo de Transferência — Administrativo',                        true, 10, null, null),
  ('Administrativo', 'transferencia_grupo', 'Regulamento do Plano de Saúde',                                          true, 20, null, null),
  ('Administrativo', 'transferencia_grupo', 'Termo Individual de Opção e Adesão ao Plano de Saúde',                   true, 30, 'acao.plano_saude', 'opta'),
  ('Administrativo', 'transferencia_grupo', 'Termo de Não Opção ao Plano de Saúde',                                   true, 30, 'acao.plano_saude', 'nao_opta'),
  ('Administrativo', 'transferencia_grupo', 'Termo de Ciência sobre Tratamento de Dados (LGPD)',                      true, 40, null, null),
  ('Administrativo', 'transferencia_grupo', 'Termo Individual de Alimentação em Cartão',                              true, 50, null, null),
  ('Administrativo', 'transferencia_grupo', 'Recibo de Entrega de Documentos e Ciência — Administrativo, transferência', true, 99, null, null),
  -- Administrativo: gestão
  ('Administrativo', 'beneficiarios_seguro', 'Formulário de Indicação de Beneficiários do Seguro de Vida',             true, 10, null, null)
)
insert into trabalhista.funcao_documentos
  (funcao_id, tipo_acao, modelo_id, obrigatorio, ordem, condicao_campo, condicao_valor)
select f.id, k.tipo_acao, m.id, k.obrigatorio, k.ordem, k.cond_campo, k.cond_valor
from k
join trabalhista.funcoes f on f.nome = k.funcao
join trabalhista.documentos_modelo m on m.nome = k.documento
on conflict do nothing;

insert into supabase_migrations.schema_migrations (version, name) values ('20261113220000','trabalhista_kit_por_acao'), ('20261113220100','trabalhista_dados_iniciais') on conflict do nothing;
commit;
