# Roteiro de migração para um projeto Supabase próprio

Hoje a gestão trabalhista vive no projeto `barreto-manutencao`, isolada no schema `trabalhista`
e no bucket `trabalhista`. Nada dela referencia o schema `public`. Quando houver plano Pro:

## 1. Criar o projeto novo
- Região `sa-east-1` (São Paulo).
- Expor o schema `trabalhista` na Data API.

## 2. Estrutura
Aplicar, em ordem, as migrações de `supabase/migrations/` que têm o prefixo `trabalhista_`.
(Os dados iniciais vêm junto, mas serão sobrescritos pelos dados reais no passo 3.)

## 3. Dados
```bash
pg_dump "$DB_ANTIGO" --schema=trabalhista --data-only --disable-triggers \
  --exclude-table=trabalhista.usuarios > trabalhista_dados.sql
psql "$DB_NOVO" -c "truncate trabalhista.funcao_documentos, trabalhista.documentos_modelo_versoes,
  trabalhista.documentos_modelo, trabalhista.campos, trabalhista.tipos_acao, trabalhista.funcoes,
  trabalhista.empresas, trabalhista.historico cascade;"
psql "$DB_NOVO" -f trabalhista_dados.sql
```
`--disable-triggers` evita que o histórico registre a carga como alterações novas.

## 4. Usuários (ponto de atenção)
Os IDs de usuário (`auth.users`) **mudam** no projeto novo. Por isso todo registro guarda também
o e-mail de quem fez (`criado_por_email`, `gerado_por_email`, `conferido_por_email`...).

1. Criar os usuários no projeto novo (mesmos e-mails).
2. Recriar `trabalhista.usuarios` a partir do export antigo, trocando `user_id` pelo novo ID do mesmo e-mail.
3. Atualizar as colunas `*_por` (uuid) pelo e-mail correspondente, por exemplo:
```sql
update trabalhista.colaboradores c set criado_por = u.id
  from auth.users u where u.email = c.criado_por_email;
-- repetir para acoes, documentos_gerados (gerado_por, assinado_enviado_por, conferido_por),
-- documentos_modelo_versoes e historico (usuario_id)
```

## 5. Arquivos
Copiar o bucket `trabalhista` inteiro mantendo os mesmos caminhos (script com a chave
`service_role` dos dois projetos: listar recursivamente, baixar do antigo, enviar ao novo).
Conferir a contagem e o tamanho total dos objetos nos dois lados.

## 6. Trocar a aplicação
Atualizar URL e chave pública do Supabase na página, testar login, geração e download.

## 7. Limpar o projeto antigo (só depois de validar)
Remover o schema e o bucket `trabalhista` do `barreto-manutencao`, e as políticas
`trabalhista_arquivos_*` de `storage.objects`.
