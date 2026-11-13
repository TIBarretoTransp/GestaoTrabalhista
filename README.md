# Gestão Trabalhista — Barreto Transportes

Aplicação para gerar, controlar e arquivar os documentos trabalhistas de cada colaborador
(admissão, gestão e demissão), com kits de documentos por função.

## Onde fica cada coisa

| Item | Local |
|---|---|
| Banco de dados | Supabase, projeto `barreto-manutencao`, **schema `trabalhista`** (isolado do `public`) |
| Arquivos | Supabase Storage, **bucket privado `trabalhista`** |
| Página | GitHub Pages deste repositório (a construir) |
| Migrações | `supabase/migrations/` (todas com o prefixo `trabalhista_`) |

O schema foi pensado para ser migrado para um projeto próprio quando houver plano Pro:
veja [docs/MIGRACAO.md](docs/MIGRACAO.md).

## Modelo de dados

- `usuarios`: quem acessa o sistema (`admin`, `operador`, `leitura`). Quem não está aqui não vê nada,
  mesmo logado no projeto (os usuários do app de manutenção ficam de fora).
- `empresas`, `funcoes`, `tipos_acao`: cadastros.
- `documentos_modelo` + `documentos_modelo_versoes`: documento-base e suas versões (.docx no bucket).
- `funcao_documentos`: o **kit** = função + tipo de ação + documento. Um documento pode ser
  condicional (`condicao_campo` / `condicao_valor`), ex.: contrato de experiência só quando
  `acao.modalidade_contrato = experiencia`.
- `campos`: dicionário de marcadores usados nos documentos-base.
- `colaboradores`, `acoes`, `documentos_gerados`: operação.
- `historico`: auditoria automática de todas as alterações (só admin consulta).
- `painel_conformidade` (view): resumo por colaborador.

Regras: nenhum colaborador, ação, documento gerado ou arquivo pode ser excluído pela aplicação —
cancela-se a ação ou dispensa-se o documento.

## Marcadores nos documentos-base

Nos .docx, os dados entram como `{grupo.campo}`:

```
Eu, {colaborador.nome}, CPF {colaborador.cpf}, admitido em {colaborador.data_admissao|data}
na função de {funcao.nome}, com salário de {colaborador.salario|moeda} ({colaborador.salario|extenso}).
Itapeva/SP, {acao.data_documento|dia} de {acao.data_documento|mes_extenso} de {acao.data_documento|ano}.
```

Grupos: `colaborador`, `empresa`, `funcao`, `acao`. A lista completa está na tabela `campos`.

Formatações disponíveis: `|data`, `|data_extenso`, `|dia`, `|mes_extenso`, `|ano`, `|moeda`,
`|extenso`, `|maiusculas`.

## Pastas do bucket

```
modelos/{modelo_id}/v{versao}.docx
colaboradores/{colaborador_id}/{acao_id}/{documento_id}_gerado.docx
colaboradores/{colaborador_id}/{acao_id}/{documento_id}_assinado.pdf
```
