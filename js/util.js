// Utilitários de interface
import { icone } from './icones.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export function aviso(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = 'aviso ' + tipo;
  el.innerHTML = icone(tipo === 'erro' ? 'alerta' : tipo === 'ok' ? 'checkCirculo' : 'info') + `<span>${esc(msg)}</span>`;
  $('#avisos').appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 8000 : 4000);
}

export function erro(e, contexto = '') {
  console.error(contexto, e);
  const msg = e?.message || e?.error_description || String(e);
  aviso((contexto ? contexto + ': ' : '') + msg, 'erro');
}

export function dataBR(v) {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

export function dataHoraBR(v) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function quandoRelativo(v) {
  if (!v) return '';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

export function hojeISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function somarDias(iso, dias) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function slug(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 90);
}

export function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function lerArquivo(arquivo) {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => falha(r.error);
    r.readAsArrayBuffer(arquivo);
  });
}

export function escolherArquivo(accept) {
  return new Promise(ok => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => ok(inp.files[0] || null);
    inp.click();
  });
}

// Diálogo modal. botoes: [{ texto, valor, classe }]. Retorna { valor, dados }.
export function dialogo({ titulo, corpo, botoes = [{ texto: 'OK', valor: true, classe: 'btn-primario' }] }) {
  return new Promise(ok => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <form method="dialog">
        <div class="dlg-corpo"><h2>${esc(titulo)}</h2>${corpo}</div>
        <div class="dlg-rodape">
          <button class="btn" value="__cancelar" formnovalidate>Cancelar</button>
          ${botoes.map((b, i) => `<button class="btn ${b.classe || ''}" value="${i}">${esc(b.texto)}</button>`).join('')}
        </div>
      </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue;
      const dados = Object.fromEntries(new FormData(form).entries());
      $$('input[type=checkbox]', form).forEach(c => { dados[c.name] = c.checked; });
      dlg.remove();
      if (v === '__cancelar' || v === '') ok({ valor: null, dados });
      else ok({ valor: botoes[+v].valor, dados });
    });
    dlg.showModal();
    const primeiro = dlg.querySelector('.dlg-corpo input, .dlg-corpo select, .dlg-corpo textarea');
    if (primeiro) primeiro.focus();
  });
}

export const confirmar = (titulo, texto, textoBotao = 'Confirmar', classe = 'btn-primario') =>
  dialogo({ titulo, corpo: `<p>${texto}</p>`, botoes: [{ texto: textoBotao, valor: true, classe }] })
    .then(r => r.valor === true);

const ETQ = {
  gerado: ['Gerado', 'cinza'],
  aguardando_assinatura: ['Aguardando assinatura', 'amarelo'],
  assinado: ['A conferir', 'roxo'],
  conferido: ['Conferido', 'verde'],
  rejeitado: ['Rejeitado', 'vermelho'],
  dispensado: ['Dispensado', 'cinza'],
  rascunho: ['Rascunho', 'cinza'],
  gerada: ['Em andamento', 'amarelo'],
  concluida: ['Concluída', 'verde'],
  cancelada: ['Cancelada', 'cinza'],
  em_admissao: ['Em admissão', 'amarelo'],
  ativo: ['Ativo', 'verde'],
  afastado: ['Afastado', 'azul'],
  desligado: ['Desligado', 'cinza'],
};
export function etiqueta(status) {
  const [t, c] = ETQ[status] || [status, 'cinza'];
  return `<span class="etq etq-${c}">${esc(t)}</span>`;
}

const CORES_AVATAR = ['#0b2c6b', '#1f5fbf', '#dd7d08', '#12805c', '#5b4bc4', '#b5476b', '#2a7f9e', '#7a5c2e'];
export function avatar(nome, tam = '') {
  const partes = String(nome || '?').trim().split(/\s+/);
  const ini = ((partes[0]?.[0] || '') + (partes.length > 1 ? partes.at(-1)[0] : '')).toUpperCase();
  let h = 0; for (const ch of String(nome)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<div class="avatar ${tam}" style="background:${CORES_AVATAR[h % CORES_AVATAR.length]}">${esc(ini)}</div>`;
}

export function barra(feitos, total) {
  const pct = total ? Math.round((feitos / total) * 100) : 0;
  return `<div class="progresso ${total && feitos >= total ? 'completo' : ''}"><div style="width:${pct}%"></div></div>`;
}

export function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export function plural(n, um, varios) { return `${n} ${n === 1 ? um : varios}`; }
