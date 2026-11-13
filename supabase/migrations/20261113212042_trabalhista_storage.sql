-- =====================================================================
-- Gestão Trabalhista — bucket privado de documentos
-- Estrutura de pastas:
--   modelos/{modelo_id}/v{versao}.docx                      (documentos-base)
--   colaboradores/{colaborador_id}/{acao_id}/{documento_id}_gerado.docx
--   colaboradores/{colaborador_id}/{acao_id}/{documento_id}_assinado.pdf
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trabalhista', 'trabalhista', false, 20971520, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
])
on conflict (id) do nothing;

-- Leitura: qualquer usuário cadastrado na gestão trabalhista
create policy trabalhista_arquivos_select on storage.objects for select to authenticated
  using (bucket_id = 'trabalhista' and (select trabalhista.tem_acesso()));

-- Envio: modelos só admin; documentos de colaboradores admin/operador
create policy trabalhista_arquivos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'trabalhista' and (
      ((storage.foldername(name))[1] = 'modelos' and (select trabalhista.eh_admin()))
      or ((storage.foldername(name))[1] = 'colaboradores' and (select trabalhista.pode_editar()))
    )
  );

-- Substituição (ex.: regerar um documento ainda não assinado)
create policy trabalhista_arquivos_update on storage.objects for update to authenticated
  using (
    bucket_id = 'trabalhista' and (
      ((storage.foldername(name))[1] = 'modelos' and (select trabalhista.eh_admin()))
      or ((storage.foldername(name))[1] = 'colaboradores' and (select trabalhista.pode_editar()))
    )
  )
  with check (
    bucket_id = 'trabalhista' and (
      ((storage.foldername(name))[1] = 'modelos' and (select trabalhista.eh_admin()))
      or ((storage.foldername(name))[1] = 'colaboradores' and (select trabalhista.pode_editar()))
    )
  );

-- Sem política de exclusão: nenhum arquivo do bucket pode ser apagado pela aplicação.
