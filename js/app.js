// vendor.js: supabase-js 2.119, docxtemplater 3.71, pizzip 3.3, angular-expressions 1.7 (empacotados com esbuild)
import { createClient, Docxtemplater, PizZip, expressions } from './vendor.js';
import { SUPABASE_URL, SUPABASE_CHAVE, SCHEMA, BUCKET } from './config.js';
import { criarMotor, montarDados, resolverKit } from './motor.js';
import { icone } from './icones.js';
import {
  esc, $, $$, aviso, erro, dataBR, dataHoraBR, quandoRelativo, hojeISO, somarDias, slug, baixarBlob, lerArquivo,
  escolherArquivo, dialogo, confirmar, etiqueta, avatar, barra, saudacao, plural,
} from './util.js';

const sb = createClient(SUPABASE_URL, SUPABASE_CHAVE, { db: { schema: SCHEMA } });
const motor = criarMotor({ Docxtemplater, PizZip, expressions });
const app = $('#app');
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', docx: MIME_DOCX };
// O Storage valida o tipo pelo Blob; garante que o arquivo nunca vá como "octet-stream"
const comTipo = (dados, tipo) => new Blob([dados], { type: tipo });

// ---------------------------------------------------------------------
// Estado e cache
// ---------------------------------------------------------------------
const estado = { sessao: null, usuario: null, cache: null, msgLogin: '' };
const ehAdmin = () => estado.usuario?.papel === 'admin';
const podeEditar = () => ['admin', 'operador'].includes(estado.usuario?.papel);

async function q(promessa, contexto) {
  const { data, error } = await promessa;
  if (error) { error.message = (contexto ? contexto + ': ' : '') + error.message; throw error; }
  return data;
}

async function carregarCache() {
  const [campos, funcoes, tipos, empresas, modelos, versoes] = await Promise.all([
    q(sb.from('campos').select('*').order('ordem'), 'campos'),
    q(sb.from('funcoes').select('*').order('nome'), 'funções'),
    q(sb.from('tipos_acao').select('*').order('ordem'), 'tipos de ação'),
    q(sb.from('empresas').select('*').order('razao_social'), 'empresas'),
    q(sb.from('documentos_modelo').select('*').order('nome'), 'documentos-base'),
    q(sb.from('documentos_modelo_versoes').select('*').order('versao', { ascending: false }), 'versões'),
  ]);
  for (const m of modelos) {
    m.versoes = versoes.filter(v => v.modelo_id === m.id);
    m.ativa = m.versoes.find(v => v.ativa) || null;
  }
  estado.cache = {
    campos, funcoes, tipos, empresas, modelos,
    campo: Object.fromEntries(campos.map(c => [c.chave, c])),
    modelo: Object.fromEntries(modelos.map(m => [m.id, m])),
    funcao: Object.fromEntries(funcoes.map(f => [f.id, f])),
    tipo: Object.fromEntries(tipos.map(t => [t.codigo, t])),
    empresa: Object.fromEntries(empresas.map(e => [e.id, e])),
  };
}

const ICONE_ETAPA = { admissao: ['usuarioMais', 'cor-azul'], gestao: ['pasta', 'cor-laranja'], demissao: ['saida', 'cor-vermelho'] };
const ICONE_TIPO = {
  admissao: 'usuarioMais', transferencia_grupo: 'maleta', banco_horas: 'relogio', beneficiarios_seguro: 'escudo',
  premiacao_mensal: 'estrela', conferencia_demonstrativo: 'conferir', sindicancia: 'alerta', demissao: 'saida',
};
const DESC_TIPO = {
  admissao: 'Contrato e todo o kit de entrada', transferencia_grupo: 'Termos da transferência entre empresas',
  banco_horas: 'Acordo individual de compensação', beneficiarios_seguro: 'Indicação ou troca de beneficiários',
  premiacao_mensal: 'Demonstrativo do mês', conferencia_demonstrativo: 'Pedido de revisão do demonstrativo',
  sindicancia: 'Apuração de acidente ou avaria', demissao: 'Documentos de desligamento',
};
function iconeTipo(codigo) {
  const etapa = estado.cache.tipo[codigo]?.etapa || 'gestao';
  return `<div class="doc-icone ${ICONE_ETAPA[etapa][1]}">${icone(ICONE_TIPO[codigo] || ICONE_ETAPA[etapa][0])}</div>`;
}

// ---------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------
function mostrarEstrutura(visivel) {
  $('#lateral').hidden = !visivel;
  $('#barra-movel').hidden = !visivel;
}

function telaLogin(msg = '') {
  msg = msg || estado.msgLogin; estado.msgLogin = '';
  mostrarEstrutura(false);
  app.classList.remove('conteudo');
  app.innerHTML = `
    <div class="login-tela">
      <div class="login-marca">
        <div class="logo-caixa"><img src="assets/logo.png" alt="Barreto Transportes"></div>
        <div>
          <h1>Documentos trabalhistas em ordem, do primeiro dia ao último.</h1>
          <ul>
            <li>${icone('raio')} Kit de admissão gerado em segundos</li>
            <li>${icone('caneta')} Controle de quem já assinou</li>
            <li>${icone('escudo')} Arquivo seguro e auditado</li>
          </ul>
        </div>
      </div>
      <div class="login-form">
        <form id="f-login">
          <div><h2>Entrar</h2><p class="muted">Gestão Trabalhista · Barreto Transportes</p></div>
          ${msg ? `<div class="caixa-alerta erro">${icone('alerta')}<span>${esc(msg)}</span></div>` : ''}
          <div class="campo"><label>E-mail</label><input type="email" name="email" required autocomplete="username" placeholder="voce@barretotransportes.com"></div>
          <div class="campo"><label>Senha</label><input type="password" name="senha" required autocomplete="current-password"></div>
          <button class="btn btn-primario btn-grande">Entrar</button>
          <button type="button" class="link-btn" id="esqueci">Esqueci minha senha</button>
        </form>
      </div>
    </div>`;
  $('#f-login').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector('.btn-primario');
    btn.disabled = true; btn.textContent = 'Entrando…';
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('senha') });
    btn.disabled = false; btn.textContent = 'Entrar';
    if (error) aviso(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message, 'erro');
  };
  $('#esqueci').onclick = async () => {
    const email = $('#f-login [name=email]').value.trim();
    if (!email) return aviso('Digite seu e-mail no campo acima.', 'erro');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return erro(error, 'Recuperação de senha');
    aviso('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.', 'ok');
  };
}

function telaNovaSenha() {
  mostrarEstrutura(false);
  app.classList.remove('conteudo');
  app.innerHTML = `
    <div class="login-tela">
      <div class="login-marca"><div class="logo-caixa"><img src="assets/logo.png" alt="Barreto Transportes"></div><div></div></div>
      <div class="login-form">
        <form id="f-senha">
          <div><h2>Criar nova senha</h2><p class="muted">Mínimo de 8 caracteres.</p></div>
          <div class="campo"><label>Nova senha</label><input type="password" name="s1" minlength="8" required autocomplete="new-password"></div>
          <div class="campo"><label>Repita a senha</label><input type="password" name="s2" minlength="8" required autocomplete="new-password"></div>
          <button class="btn btn-primario btn-grande">Salvar senha</button>
        </form>
      </div>
    </div>`;
  $('#f-senha').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    if (f.get('s1') !== f.get('s2')) return aviso('As senhas não conferem.', 'erro');
    const { error } = await sb.auth.updateUser({ password: f.get('s1') });
    if (error) return erro(error, 'Nova senha');
    aviso('Senha alterada.', 'ok');
    location.hash = '#/inicio';
    iniciarSessao();
  };
}

async function iniciarSessao() {
  const { data: { session } } = await sb.auth.getSession();
  estado.sessao = session;
  if (!session) return telaLogin();
  try {
    const linhas = await q(sb.from('usuarios').select('*').eq('user_id', session.user.id));
    estado.usuario = linhas.find(u => u.ativo) || null;
  } catch (e) {
    const semSchema = /schema|PGRST106|Invalid schema/i.test(e.message || '');
    return telaLogin(semSchema
      ? 'O schema "trabalhista" ainda não está exposto na Data API do Supabase.'
      : 'Não foi possível verificar seu acesso: ' + e.message);
  }
  if (!estado.usuario) {
    estado.msgLogin = 'Seu login não tem acesso à Gestão Trabalhista. Peça a liberação a um administrador.';
    estado.sessao = null;
    await sb.auth.signOut();
    return telaLogin();
  }
  await carregarCache().catch(e => erro(e, 'Carregando cadastros'));
  app.classList.add('conteudo');
  mostrarEstrutura(true);
  $('#eu').innerHTML = `${avatar(estado.usuario.nome, 'p')}<div style="min-width:0"><div class="eu-nome">${esc(estado.usuario.nome)}</div>
    <div class="eu-papel">${esc({ admin: 'Administrador', operador: 'Operador', leitura: 'Consulta' }[estado.usuario.papel])}</div></div>`;
  rotear();
}

$('#sair').onclick = async () => { await sb.auth.signOut(); location.hash = ''; };
$('#abrir-menu').onclick = () => $('#lateral').classList.toggle('aberta');

// Chamadas ao Supabase dentro do callback são adiadas (evita travamento do cliente de autenticação)
sb.auth.onAuthStateChange((evento, sessao) => {
  if (evento === 'PASSWORD_RECOVERY') { setTimeout(telaNovaSenha, 0); return; }
  if (evento === 'SIGNED_IN' && !estado.sessao) setTimeout(iniciarSessao, 0);
  if (evento === 'SIGNED_OUT') { estado.sessao = null; estado.usuario = null; setTimeout(() => { if (!$('#f-login')) telaLogin(); }, 0); }
  if (sessao) estado.sessao = sessao;
});

// ---------------------------------------------------------------------
// Menu e roteamento
// ---------------------------------------------------------------------
async function desenharMenu(rota) {
  const ativo = { colaborador: 'colaboradores', editar: 'colaboradores', acao: 'colaboradores' }[rota] || rota;
  const pintar = aConferir => {
    const itens = [
      ['inicio', 'Início', 'inicio'],
      ['colaboradores', 'Colaboradores', 'equipe'],
      ['conferir', 'Conferir assinaturas', 'conferir', aConferir],
      ...(ehAdmin() ? [['cadastros', 'Cadastros', 'ajustes']] : []),
    ];
    $('#menu').innerHTML = itens.map(([r, t, i, n]) =>
      `<a href="#/${r}" class="${r === ativo ? 'ativo' : ''}">${icone(i)}<span>${t}</span>${n ? `<span class="contador">${n}</span>` : ''}</a>`).join('')
      + (podeEditar() ? `<a href="#/admissao" class="menu-acao">${icone('usuarioMais')}<span>Nova admissão</span></a>` : '');
  };
  pintar(0);
  try {
    const r = await sb.from('documentos_gerados').select('id', { count: 'exact', head: true }).eq('status', 'assinado');
    if (r.count) pintar(r.count);
  } catch { /* contador é opcional */ }
}

const ROTAS = {
  inicio: telaInicio,
  colaboradores: telaColaboradores,
  colaborador: telaColaborador,
  editar: telaEditarColaborador,
  admissao: () => iniciarAssistente(null, 'admissao'),
  acao: (id, tipo) => iniciarAssistente(id, tipo),
  conferir: telaConferir,
  cadastros: telaCadastros,
};

async function rotear() {
  if (!estado.usuario) return;
  const [rota, ...args] = (location.hash.replace(/^#\/?/, '') || 'inicio').split('/');
  $('#lateral').classList.remove('aberta');
  desenharMenu(rota);
  const fn = ROTAS[rota] || telaInicio;
  app.innerHTML = '<p class="carregando">Carregando…</p>';
  window.scrollTo(0, 0);
  try { await fn(...args.map(decodeURIComponent)); }
  catch (e) { erro(e); app.innerHTML = `<div class="caixa-alerta erro">${icone('alerta')}<span>${esc(e.message)}</span></div>`; }
}
window.addEventListener('hashchange', rotear);

// ---------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------
async function telaInicio() {
  const linhas = await q(sb.from('painel_conformidade').select('*').order('nome'));
  const ativos = linhas.filter(l => l.situacao !== 'desligado');
  const soma = k => ativos.reduce((s, l) => s + Number(l[k] || 0), 0);
  const aguard = soma('pendentes_assinatura'), conf = soma('aguardando_conferencia');
  const emAdmissao = ativos.filter(l => l.situacao === 'em_admissao').length;
  const nome = (estado.usuario.nome || '').split(' ')[0];
  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  // pendências em ordem de prioridade
  const pend = [];
  for (const l of ativos) {
    const abrir = `#/colaborador/${l.colaborador_id}`;
    if (+l.aguardando_conferencia) pend.push({ p: 1, l, cor: 'roxo', ic: 'conferir', t: `${plural(+l.aguardando_conferencia, 'documento assinado', 'documentos assinados')} para conferir`, btn: podeEditar() ? `<button class="btn btn-pequeno btn-primario" data-conferir="${l.colaborador_id}">Conferir</button>` : `<a class="btn btn-pequeno" href="${abrir}">Abrir</a>` });
    if (+l.rejeitados) pend.push({ p: 2, l, cor: 'vermelho', ic: 'xCirculo', t: `${plural(+l.rejeitados, 'documento rejeitado', 'documentos rejeitados')} — reenviar assinado`, btn: `<a class="btn btn-pequeno" href="${abrir}">Abrir</a>` });
    if (+l.vencidos) pend.push({ p: 2, l, cor: 'vermelho', ic: 'alerta', t: plural(+l.vencidos, 'documento vencido', 'documentos vencidos'), btn: `<a class="btn btn-pequeno" href="${abrir}">Abrir</a>` });
    if (l.situacao === 'em_admissao' && !+l.documentos_total) pend.push({ p: 3, l, cor: 'amarelo', ic: 'documento', t: 'Kit de admissão ainda não gerado', btn: podeEditar() ? `<a class="btn btn-pequeno btn-destaque" href="#/acao/${l.colaborador_id}/admissao">Gerar kit</a>` : '' });
    const aguardando = (+l.pendentes_assinatura || 0) - (+l.rejeitados || 0);
    if (aguardando > 0) pend.push({ p: 4, l, cor: 'amarelo', ic: 'caneta', t: `${plural(aguardando, 'documento aguardando', 'documentos aguardando')} assinatura`, btn: `<a class="btn btn-pequeno" href="${abrir}">Abrir</a>` });
  }
  pend.sort((a, b) => a.p - b.p);
  const equipe = [...ativos].filter(l => +l.documentos_total).sort((a, b) => progresso(a) - progresso(b)).slice(0, 8);

  app.innerHTML = `
    <section class="saudacao">
      <div><h1>${saudacao()}, ${esc(nome)}!</h1><p>Hoje é ${esc(hoje)}. ${pend.length ? `Você tem ${plural(pend.length, 'pendência', 'pendências')}.` : 'Tudo em dia por aqui.'}</p></div>
      <div class="acoes">
        ${conf && podeEditar() ? `<a class="btn btn-fantasma" href="#/conferir">${icone('conferir')} Conferir ${conf}</a>` : ''}
        ${podeEditar() ? `<a class="btn btn-destaque btn-grande" href="#/admissao">${icone('usuarioMais')} Nova admissão</a>` : ''}
      </div>
    </section>
    <div class="kpis">
      <a class="kpi" href="#/colaboradores"><div class="kpi-icone cor-azul">${icone('equipe')}</div><div><div class="kpi-valor">${ativos.length}</div><div class="kpi-rotulo">Colaboradores</div></div></a>
      <a class="kpi" href="#/colaboradores"><div class="kpi-icone cor-laranja">${icone('usuarioMais')}</div><div><div class="kpi-valor">${emAdmissao}</div><div class="kpi-rotulo">Em admissão</div></div></a>
      <div class="kpi"><div class="kpi-icone cor-amarelo">${icone('caneta')}</div><div><div class="kpi-valor">${aguard}</div><div class="kpi-rotulo">Aguardando assinatura</div></div></div>
      <a class="kpi" href="#/conferir"><div class="kpi-icone cor-roxo">${icone('conferir')}</div><div><div class="kpi-valor">${conf}</div><div class="kpi-rotulo">Assinados a conferir</div></div></a>
    </div>
    <div class="grade-2">
      <div class="cartao">
        <div class="cartao-topo"><h2>O que precisa da sua atenção</h2></div>
        ${pend.length ? `<ul class="pendencias">${pend.slice(0, 12).map(x => `
          <li class="pendencia">
            ${avatar(x.l.nome)}
            <div class="info"><div class="titulo">${esc(x.l.nome)}</div>
              <div class="detalhe"><span class="etq etq-${x.cor}">${esc(x.t)}</span></div></div>
            ${x.btn}
          </li>`).join('')}</ul>` : `
          <div class="vazio-bonito">${icone('checkCirculo')}<div class="titulo">Nenhuma pendência</div>
            <div>${ativos.length ? 'Todos os documentos estão em dia.' : 'Comece cadastrando a primeira admissão.'}</div>
            ${!ativos.length && podeEditar() ? `<p style="margin-top:14px"><a class="btn btn-destaque" href="#/admissao">${icone('usuarioMais')} Nova admissão</a></p>` : ''}</div>`}
      </div>
      <div class="cartao">
        <div class="cartao-topo"><h2>Situação da equipe</h2><a class="btn btn-fantasma btn-pequeno" href="#/colaboradores">Ver todos</a></div>
        ${equipe.length ? equipe.map(l => {
          const [f, t] = contagem(l);
          return `<a href="#/colaborador/${l.colaborador_id}" style="display:block;text-decoration:none;color:inherit;margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:14px;margin-bottom:6px"><b>${esc(l.nome)}</b><span class="muted">${f}/${t}</span></div>
            ${barra(f, t)}</a>`;
        }).join('') : '<p class="muted">Nenhum documento gerado ainda.</p>'}
      </div>
    </div>`;
  $$('[data-conferir]').forEach(b => { b.onclick = () => conferirColaborador(b.dataset.conferir); });
}

const contagem = l => [(+l.conferidos || 0) + (+l.dispensados || 0), +l.documentos_total || 0];
const progresso = l => { const [f, t] = contagem(l); return t ? f / t : -1; };

// ---------------------------------------------------------------------
// Colaboradores
// ---------------------------------------------------------------------
let filtroSituacao = '';
async function telaColaboradores() {
  const linhas = await q(sb.from('painel_conformidade').select('*').order('nome'));
  const cont = s => linhas.filter(l => l.situacao === s).length;
  app.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Colaboradores</h1><p class="sub">${plural(linhas.length, 'pessoa cadastrada', 'pessoas cadastradas')}</p></div>
      <div class="acoes">${podeEditar() ? `<a class="btn btn-destaque" href="#/admissao">${icone('usuarioMais')} Nova admissão</a>` : ''}</div>
    </div>
    <div class="filtros">
      <div class="chips">
        ${[['', 'Todos', linhas.length], ['em_admissao', 'Em admissão', cont('em_admissao')], ['ativo', 'Ativos', cont('ativo')],
           ['afastado', 'Afastados', cont('afastado')], ['desligado', 'Desligados', cont('desligado')]]
          .map(([v, t, n]) => `<button class="chip ${filtroSituacao === v ? 'ativo' : ''}" data-sit="${v}">${t}<span class="n">${n}</span></button>`).join('')}
      </div>
      <div class="busca">${icone('busca')}<input id="busca" placeholder="Buscar por nome ou CPF" autocomplete="off"></div>
    </div>
    <div class="grade-cards" id="cards"></div>`;
  const desenhar = () => {
    const t = $('#busca').value.toLowerCase().trim(), td = t.replace(/\D/g, '');
    const f = linhas.filter(l => (!filtroSituacao || l.situacao === filtroSituacao) &&
      (!t || l.nome.toLowerCase().includes(t) || (td && (l.cpf || '').replace(/\D/g, '').includes(td))));
    $('#cards').innerHTML = f.map(l => {
      const [feitos, total] = contagem(l);
      const alertas = [
        +l.aguardando_conferencia ? `<span class="etq etq-roxo">${l.aguardando_conferencia} a conferir</span>` : '',
        +l.pendentes_assinatura ? `<span class="etq etq-amarelo">${l.pendentes_assinatura} sem assinatura</span>` : '',
        +l.vencidos ? `<span class="etq etq-vermelho">${l.vencidos} vencido(s)</span>` : '',
      ].join('');
      return `<a class="card-colab" href="#/colaborador/${l.colaborador_id}">
        <div class="topo">${avatar(l.nome)}<div style="min-width:0;flex:1"><div class="nome">${esc(l.nome)}</div><div class="funcao">${esc(l.funcao || 'Sem função')}</div></div>${etiqueta(l.situacao)}</div>
        <div>${barra(feitos, total)}<div class="progresso-legenda"><span>${total ? `${feitos} de ${total} documentos concluídos` : 'Nenhum documento gerado'}</span></div></div>
        ${alertas ? `<div class="alertas">${alertas}</div>` : ''}
      </a>`;
    }).join('') || `<div class="cartao vazio-bonito" style="grid-column:1/-1">${icone('busca')}<div class="titulo">Ninguém encontrado</div><div>Ajuste a busca ou o filtro.</div></div>`;
  };
  $$('[data-sit]').forEach(b => { b.onclick = () => { filtroSituacao = b.dataset.sit; $$('[data-sit]').forEach(x => x.classList.toggle('ativo', x === b)); desenhar(); }; });
  $('#busca').oninput = desenhar;
  desenhar();
}

// ---------------------------------------------------------------------
// Formulário do colaborador (usado no assistente e na edição)
// ---------------------------------------------------------------------
const ROTULOS_OPCAO = {
  indeterminado: ['Prazo indeterminado', 'Contrato efetivo desde o início'],
  experiencia: ['Contrato de experiência', 'Até 90 dias, prorrogável uma vez'],
  opta: ['Opta pelo plano', 'Gera o termo de adesão'],
  nao_opta: ['Não opta pelo plano', 'Gera o termo de não opção'],
};
const rotuloOpcao = o => ROTULOS_OPCAO[o]?.[0] || o;

function inputCampo(c, valor, nome = c.chave) {
  const obrig = c.obrigatorio ? 'required' : '';
  const v = valor ?? '';
  let inp;
  switch (c.tipo) {
    case 'data': inp = `<input type="date" name="${nome}" value="${esc(v)}" ${obrig}>`; break;
    case 'moeda': inp = `<input type="number" step="0.01" min="0" name="${nome}" value="${esc(v)}" ${obrig} placeholder="0,00">`; break;
    case 'numero': inp = `<input type="number" step="any" name="${nome}" value="${esc(v)}" ${obrig}>`; break;
    case 'inteiro': inp = `<input type="number" step="1" name="${nome}" value="${esc(v)}" ${obrig}>`; break;
    case 'email': inp = `<input type="email" name="${nome}" value="${esc(v)}" ${obrig}>`; break;
    case 'texto_longo': inp = `<textarea name="${nome}" ${obrig}>${esc(v)}</textarea>`; break;
    case 'sim_nao': inp = `<select name="${nome}" ${obrig}><option value=""></option>
      <option value="sim" ${v === 'sim' ? 'selected' : ''}>Sim</option><option value="nao" ${v === 'nao' ? 'selected' : ''}>Não</option></select>`; break;
    case 'lista': {
      const ops = Array.isArray(c.opcoes) ? c.opcoes : [];
      inp = `<select name="${nome}" ${obrig}><option value=""></option>${ops.map(o =>
        `<option value="${esc(o)}" ${String(v) === String(o) ? 'selected' : ''}>${esc(rotuloOpcao(o))}</option>`).join('')}</select>`;
      break;
    }
    default: {
      const mask = { cpf: '000.000.000-00', cnpj: '00.000.000/0000-00', cep: '00000-000', telefone: '(15) 90000-0000' }[c.tipo];
      inp = `<input type="text" name="${nome}" value="${esc(v)}" ${obrig} ${mask ? `placeholder="${mask}" inputmode="numeric" data-mask="${c.tipo}"` : ''}
        ${c.chave === 'colaborador.uf' ? 'maxlength="2" style="text-transform:uppercase"' : ''}>`;
    }
  }
  const largura = c.tipo === 'texto_longo' ? 'largo' : ['colaborador.nome', 'colaborador.endereco'].includes(c.chave) ? 'duplo' : '';
  return `<div class="campo ${largura}">
    <label>${esc(c.rotulo)}${c.obrigatorio ? ' <span class="obrig">*</span>' : ''}</label>${inp}
    ${c.ajuda ? `<small>${esc(c.ajuda)}</small>` : ''}</div>`;
}

function escolhasCampo(c, valor) {
  const ops = Array.isArray(c.opcoes) ? c.opcoes : [];
  return `<div class="campo largo"><label>${esc(c.rotulo)} <span class="obrig">*</span></label><div class="escolhas">
    ${ops.map(o => `<label class="escolha"><input type="radio" name="${c.chave}" value="${esc(o)}" ${String(valor) === String(o) ? 'checked' : ''} required>
      <span>${esc(rotuloOpcao(o))}${ROTULOS_OPCAO[o]?.[1] ? `<small>${esc(ROTULOS_OPCAO[o][1])}</small>` : ''}</span></label>`).join('')}
  </div></div>`;
}

function aplicarMascaras(raiz) {
  const fmt = {
    cpf: d => d.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'),
    cnpj: d => d.slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2'),
    cep: d => d.slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2'),
    telefone: d => d.slice(0, 11).replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4,5})(\d{4})$/, '$1-$2'),
  };
  $$('input[data-mask]', raiz).forEach(inp => {
    const f = fmt[inp.dataset.mask];
    if (f) inp.addEventListener('input', () => { inp.value = f(inp.value.replace(/\D/g, '')); });
  });
}

// CEP → endereço (ViaCEP); falha silenciosa
function buscaCep(form) {
  const cep = form.elements['colaborador.cep'];
  if (!cep) return;
  cep.addEventListener('change', async () => {
    const d = cep.value.replace(/\D/g, '');
    if (d.length !== 8) return;
    try {
      const r = await (await fetch(`https://viacep.com.br/ws/${d}/json/`)).json();
      if (r.erro) return;
      const pre = (n, v) => { const el = form.elements['colaborador.' + n]; if (el && !el.value && v) el.value = v; };
      pre('endereco', r.logradouro); pre('bairro', r.bairro); pre('cidade', r.localidade); pre('uf', r.uf);
      aviso('Endereço preenchido pelo CEP.');
      form.elements['colaborador.numero']?.focus();
    } catch { /* sem internet ou serviço fora */ }
  });
}

const SECOES_COLAB = [
  ['Identificação', 'idCartao', ['nome', 'cpf', 'rg', 'rg_orgao', 'data_nascimento', 'estado_civil', 'nacionalidade']],
  ['Contrato', 'dinheiro', ['data_admissao', 'salario']],
  ['Contato e endereço', 'casaEnd', ['telefone', 'email', 'cep', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf']],
  ['Documentos', 'documento', ['pis', 'ctps_numero', 'ctps_serie', 'cnh_numero', 'cnh_categoria', 'cnh_validade']],
];

function formColaborador(c, { comSituacao = false } = {}) {
  const { campos, funcoes, empresas } = estado.cache;
  const doGrupo = campos.filter(x => x.grupo === 'colaborador' && x.ativo && !x.calculado);
  const valor = x => x.coluna_origem ? c[x.coluna_origem] : (c.dados_extras || {})[x.chave.split('.')[1]];
  const usados = new Set(SECOES_COLAB.flatMap(s => s[2]));
  const extras = doGrupo.filter(x => !usados.has(x.chave.split('.')[1]));
  const html = nomes => nomes.map(n => doGrupo.find(x => x.chave === 'colaborador.' + n)).filter(Boolean).map(x => inputCampo(x, valor(x))).join('');
  const empresasAtivas = empresas.filter(e => e.ativo || e.id === c.empresa_id);
  const funcoesAtivas = funcoes.filter(f => f.ativo || f.id === c.funcao_id);

  return `
    <div class="secao-form"><h3>${icone('maleta')} Função</h3>
      <div class="escolhas" style="margin-bottom:14px">${funcoesAtivas.map(f => `
        <label class="escolha"><input type="radio" name="funcao_id" value="${f.id}" ${f.id === c.funcao_id ? 'checked' : ''} required>
          <span>${esc(f.nome)}${f.descricao ? `<small>${esc(f.descricao)}</small>` : ''}</span></label>`).join('')}</div>
      <div class="form-grade">
        <div class="campo ${empresasAtivas.length < 2 ? '' : ''}" ${empresasAtivas.length < 2 ? 'hidden' : ''}><label>Empresa <span class="obrig">*</span></label><select name="empresa_id" required>
          ${empresasAtivas.map(e => `<option value="${e.id}" ${e.id === c.empresa_id ? 'selected' : ''}>${esc(e.razao_social)}</option>`).join('')}</select></div>
        ${comSituacao ? `
        <div class="campo"><label>Situação</label><select name="situacao">
          ${['em_admissao', 'ativo', 'afastado', 'desligado'].map(s => `<option value="${s}" ${s === c.situacao ? 'selected' : ''}>${{ em_admissao: 'Em admissão', ativo: 'Ativo', afastado: 'Afastado', desligado: 'Desligado' }[s]}</option>`).join('')}</select></div>
        <div class="campo"><label>Data de desligamento</label><input type="date" name="data_desligamento" value="${esc(c.data_desligamento || '')}"></div>` : ''}
      </div>
    </div>
    ${SECOES_COLAB.map(([t, ic, n]) => `<div class="secao-form"><h3>${icone(ic)} ${t}</h3><div class="form-grade">${html(n)}</div></div>`).join('')}
    ${extras.length ? `<div class="secao-form"><h3>${icone('pasta')} Outros dados</h3><div class="form-grade">${extras.map(x => inputCampo(x, valor(x))).join('')}</div></div>` : ''}`;
}

function lerColaborador(form, c) {
  const f = new FormData(form);
  const reg = { empresa_id: f.get('empresa_id'), funcao_id: f.get('funcao_id') || null, dados_extras: { ...(c.dados_extras || {}) } };
  if (f.has('situacao')) { reg.situacao = f.get('situacao'); reg.data_desligamento = f.get('data_desligamento') || null; }
  for (const x of estado.cache.campos.filter(y => y.grupo === 'colaborador' && y.ativo && !y.calculado)) {
    let v = f.get(x.chave);
    if (v === null) continue;
    v = String(v).trim();
    const val = v === '' ? null : (['moeda', 'numero', 'inteiro'].includes(x.tipo) ? Number(v) : v);
    if (x.coluna_origem) reg[x.coluna_origem] = val;
    else reg.dados_extras[x.chave.split('.')[1]] = val;
  }
  if (reg.uf) reg.uf = reg.uf.toUpperCase().slice(0, 2);
  return reg;
}

async function salvarColaborador(form, c) {
  if (!form.reportValidity()) return null;
  const reg = lerColaborador(form, c);
  try {
    return c.id
      ? await q(sb.from('colaboradores').update(reg).eq('id', c.id).select('*').single())
      : await q(sb.from('colaboradores').insert(reg).select('*').single());
  } catch (e) {
    erro(/colaboradores_cpf_key|duplicate/.test(e.message) ? new Error('Já existe um colaborador com este CPF.') : e, 'Salvar');
    return null;
  }
}

async function telaEditarColaborador(id) {
  if (!podeEditar()) throw new Error('Sem permissão para editar colaboradores.');
  const c = await q(sb.from('colaboradores').select('*').eq('id', id).single());
  app.innerHTML = `
    <a class="voltar" href="#/colaborador/${c.id}">${icone('voltar')} ${esc(c.nome)}</a>
    <div class="pagina-topo"><div><h1>Editar dados</h1><p class="sub">As alterações valem para os próximos documentos gerados.</p></div></div>
    <form id="f-colab" class="cartao" novalidate>
      ${formColaborador(c, { comSituacao: true })}
      <div class="rodape-wizard" style="margin-top:22px"><a class="btn" href="#/colaborador/${c.id}">Cancelar</a>
        <button class="btn btn-primario">${icone('check')} Salvar alterações</button></div>
    </form>`;
  const form = $('#f-colab');
  aplicarMascaras(form); buscaCep(form);
  form.onsubmit = async ev => {
    ev.preventDefault();
    const salvo = await salvarColaborador(form, c);
    if (salvo) { aviso('Dados salvos.', 'ok'); location.hash = '#/colaborador/' + c.id; }
  };
}

// ---------------------------------------------------------------------
// Página do colaborador
// ---------------------------------------------------------------------
async function telaColaborador(id, aba = 'documentos') {
  const [c, acoes, docs] = await Promise.all([
    q(sb.from('colaboradores').select('*').eq('id', id).single()),
    q(sb.from('acoes').select('*').eq('colaborador_id', id).order('criado_em', { ascending: false })),
    q(sb.from('documentos_gerados').select('*').eq('colaborador_id', id)),
  ]);
  const { funcao, empresa } = estado.cache;
  const validas = new Set(acoes.filter(a => a.status !== 'cancelada').map(a => a.id));
  const docsValidos = docs.filter(d => validas.has(d.acao_id));
  const feitos = docsValidos.filter(d => ['conferido', 'dispensado'].includes(d.status)).length;

  app.innerHTML = `
    <a class="voltar" href="#/colaboradores">${icone('voltar')} Colaboradores</a>
    <div class="cartao">
      <div class="perfil">
        ${avatar(c.nome, 'g')}
        <div class="dados">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h1>${esc(c.nome)}</h1>${etiqueta(c.situacao)}</div>
          <div class="linha-info">
            <span>${icone('maleta')} ${esc(funcao[c.funcao_id]?.nome || 'Sem função')}</span>
            <span>${icone('idCartao')} <span class="mono">${esc(c.cpf)}</span></span>
            <span>${icone('calendario')} Admissão ${dataBR(c.data_admissao)}</span>
            ${c.telefone ? `<span>${icone('telefone')} ${esc(c.telefone)}</span>` : ''}
          </div>
        </div>
        ${podeEditar() ? `<div class="grupo-btn">
          <a class="btn" href="#/editar/${c.id}">${icone('editar')} Editar</a>
          <a class="btn btn-destaque" href="#/acao/${c.id}">${icone('mais')} Nova ação</a></div>` : ''}
      </div>
      ${docsValidos.length ? `<div style="margin-top:18px">${barra(feitos, docsValidos.length)}
        <div class="progresso-legenda"><span>${feitos} de ${docsValidos.length} documentos concluídos</span><span>${Math.round(feitos / docsValidos.length * 100)}%</span></div></div>` : ''}
    </div>
    <div class="abas">
      <button data-aba="documentos" class="${aba === 'documentos' ? 'ativa' : ''}">${icone('documento', 'width="16" height="16"')} Documentos <span class="n">${docsValidos.length}</span></button>
      <button data-aba="dados" class="${aba === 'dados' ? 'ativa' : ''}">${icone('idCartao', 'width="16" height="16"')} Dados cadastrais</button>
      <button data-aba="historico" class="${aba === 'historico' ? 'ativa' : ''}">${icone('historico', 'width="16" height="16"')} Histórico</button>
    </div>
    <div id="aba-conteudo"></div>`;
  $$('.abas button').forEach(b => { b.onclick = () => { history.replaceState(null, '', `#/colaborador/${c.id}/${b.dataset.aba}`); telaColaborador(c.id, b.dataset.aba); }; });

  const alvo = $('#aba-conteudo');
  if (aba === 'dados') return abaDadosColaborador(alvo, c, empresa);
  if (aba === 'historico') return abaHistorico(alvo, c, acoes, docs);
  abaDocumentos(alvo, c, acoes, docs);
}

function abaDocumentos(alvo, c, acoes, docs) {
  const { tipo, modelo } = estado.cache;
  if (!acoes.length) {
    alvo.innerHTML = `<div class="cartao vazio-bonito">${icone('documento', 'style="color:var(--azul)"')}
      <div class="titulo">Nenhum documento ainda</div><div>Gere o kit de admissão para começar.</div>
      ${podeEditar() ? `<p style="margin-top:14px"><a class="btn btn-destaque" href="#/acao/${c.id}/admissao">${icone('usuarioMais')} Gerar kit de admissão</a></p>` : ''}</div>`;
    return;
  }
  alvo.innerHTML = acoes.map(a => {
    const ds = docs.filter(d => d.acao_id === a.id)
      .sort((x, y) => ordemStatus(x) - ordemStatus(y) || (modelo[x.modelo_id]?.nome || '').localeCompare(modelo[y.modelo_id]?.nome || ''));
    const n = s => ds.filter(d => s.includes(d.status)).length;
    const cancelada = a.status === 'cancelada';
    return `<div class="cartao" ${cancelada ? 'style="opacity:.6"' : ''}>
      <div class="acao-topo">
        <div class="titulo">${iconeTipo(a.tipo_acao)}
          <div><h2 style="margin:0">${esc(tipo[a.tipo_acao]?.nome || a.tipo_acao)}</h2>
            <span class="muted">${dataBR(a.data_acao)}${a.criado_por_email ? ' · por ' + esc(a.criado_por_email) : ''}</span></div>
          ${etiqueta(a.status)}</div>
        <div class="grupo-btn">
          ${ds.length ? `<button class="btn btn-pequeno" data-zip="${a.id}">${icone('download')} Baixar para imprimir</button>` : ''}
          ${podeEditar() && !cancelada && a.status !== 'concluida' ? `<div class="mais"><button class="btn btn-pequeno btn-icone" data-mais aria-label="Mais opções">${icone('reticencias')}</button>
            <div class="mais-lista"><button class="perigo" data-cancelar="${a.id}">${icone('xCirculo')} Cancelar ação</button></div></div>` : ''}
        </div>
      </div>
      ${cancelada ? `<p class="muted" style="margin-top:10px">Cancelada: ${esc(a.observacao || '')}</p>` : `
      <div class="etapas-acao">
        <div class="etapa-acao"><div class="v" style="color:var(--amarelo)">${n(['gerado', 'aguardando_assinatura', 'rejeitado'])}</div><div class="r">Aguardando assinatura</div></div>
        <div class="etapa-acao"><div class="v" style="color:var(--roxo)">${n(['assinado'])}</div><div class="r">Assinados a conferir</div></div>
        <div class="etapa-acao"><div class="v" style="color:var(--verde)">${n(['conferido', 'dispensado'])}</div><div class="r">Concluídos</div></div>
      </div>`}
      <ul class="docs">${ds.map(d => linhaDoc(d, cancelada)).join('')}</ul>
      ${!cancelada && podeEditar() && n(['gerado', 'aguardando_assinatura', 'rejeitado']) ? `<div class="dica-arrastar">${icone('upload')} Dica: arraste o PDF ou a foto assinada direto para cima do documento.</div>` : ''}
    </div>`;
  }).join('');

  const porId = Object.fromEntries(docs.map(d => [d.id, d]));
  const recarregar = () => telaColaborador(c.id, 'documentos');
  $$('[data-doc-acao]', alvo).forEach(b => {
    b.onclick = ev => { ev.stopPropagation(); fecharMenus(); acaoDocumento(b.dataset.docAcao, porId[b.dataset.doc], c, recarregar); };
  });
  $$('[data-zip]', alvo).forEach(b => { b.onclick = () => baixarZip(acoes.find(a => a.id === b.dataset.zip), docs.filter(d => d.acao_id === b.dataset.zip), c); });
  ligarMenus(alvo);
  $$('[data-cancelar]', alvo).forEach(b => {
    b.onclick = async () => {
      fecharMenus();
      const r = await dialogo({
        titulo: 'Cancelar ação',
        corpo: '<p>Os documentos já gerados continuam arquivados, mas deixam de contar como pendência. Informe o motivo:</p><div class="campo"><textarea name="motivo" required></textarea></div>',
        botoes: [{ texto: 'Cancelar ação', valor: true, classe: 'btn-perigo' }],
      });
      if (!r.valor) return;
      try { await q(sb.from('acoes').update({ status: 'cancelada', observacao: r.dados.motivo }).eq('id', b.dataset.cancelar)); aviso('Ação cancelada.', 'ok'); recarregar(); }
      catch (e) { erro(e, 'Cancelar'); }
    };
  });
  // arrastar e soltar o assinado
  $$('.doc[data-solta]', alvo).forEach(li => {
    li.addEventListener('dragover', ev => { ev.preventDefault(); li.classList.add('arrastando'); });
    li.addEventListener('dragleave', () => li.classList.remove('arrastando'));
    li.addEventListener('drop', ev => {
      ev.preventDefault(); li.classList.remove('arrastando');
      const arq = ev.dataTransfer.files[0];
      if (arq) enviarAssinado(porId[li.dataset.solta], c, arq).then(ok => ok && recarregar());
    });
  });
}

const ORDEM_STATUS = { rejeitado: 0, assinado: 1, aguardando_assinatura: 2, gerado: 2, conferido: 3, dispensado: 4 };
const ordemStatus = d => ORDEM_STATUS[d.status] ?? 5;

const ESTADO_DOC = {
  gerado: ['caneta', 'cor-amarelo'], aguardando_assinatura: ['caneta', 'cor-amarelo'], rejeitado: ['xCirculo', 'cor-vermelho'],
  assinado: ['conferir', 'cor-roxo'], conferido: ['check', 'cor-verde'], dispensado: ['documento', 'cor-azul'],
};

function linhaDoc(d, bloqueado = false) {
  const m = estado.cache.modelo[d.modelo_id];
  const v = m?.versoes.find(x => x.id === d.versao_id);
  const [ic, cor] = ESTADO_DOC[d.status] || ['documento', 'cor-azul'];
  const b = (acao, texto, classe = '', icn = '') => `<button class="btn btn-pequeno ${classe}" data-doc="${d.id}" data-doc-acao="${acao}">${icn ? icone(icn) : ''}${texto}</button>`;
  const item = (acao, texto, icn, cls = '') => `<button class="${cls}" data-doc="${d.id}" data-doc-acao="${acao}">${icone(icn)} ${texto}</button>`;
  const pode = podeEditar() && !bloqueado;
  let principal = '';
  if (pode && ['gerado', 'aguardando_assinatura', 'rejeitado'].includes(d.status)) principal = b('enviar', 'Enviar assinado', 'btn-primario', 'upload');
  else if (pode && d.status === 'assinado') principal = b('conferir', 'Conferir', 'btn-primario', 'conferir');
  else if (d.arquivo_assinado_path) principal = b('ver-assinado', 'Ver assinado', '', 'olho');
  const menu = [
    d.arquivo_gerado_path ? item('baixar', 'Baixar .docx', 'download') : '',
    d.arquivo_assinado_path && !principal.includes('ver-assinado') ? item('ver-assinado', 'Ver assinado', 'olho') : '',
    pode && d.status === 'assinado' ? item('rejeitar', 'Rejeitar assinado', 'xCirculo', 'perigo') : '',
    pode && !['conferido', 'dispensado'].includes(d.status) ? item('dispensar', 'Dispensar', 'bloquear', 'perigo') : '',
  ].join('');
  const meta = d.status === 'rejeitado' ? `<span style="color:var(--vermelho)">Rejeitado: ${esc(d.motivo_rejeicao || '')}</span>`
    : d.status === 'dispensado' ? esc(d.motivo_dispensa || 'Dispensado')
    : d.status === 'conferido' ? `Conferido ${quandoRelativo(d.conferido_em)}${d.conferido_por_email ? ' por ' + esc(d.conferido_por_email) : ''}`
    : d.status === 'assinado' ? `Enviado ${quandoRelativo(d.assinado_enviado_em)} · aguardando conferência`
    : `Gerado ${quandoRelativo(d.gerado_em)} · modelo v${v?.versao ?? '?'}`;
  const solta = pode && ['gerado', 'aguardando_assinatura', 'rejeitado'].includes(d.status);
  return `<li class="doc" ${solta ? `data-solta="${d.id}"` : ''}>
    <div class="estado ${cor}">${icone(ic)}</div>
    <div class="info"><div class="nome">${esc(m?.nome || 'Documento')}${d.obrigatorio ? '' : ' <span class="etq etq-cinza sem-ponto">opcional</span>'}</div>
      <div class="meta">${meta}${d.validade_ate ? ' · vence ' + dataBR(d.validade_ate) : ''}</div></div>
    <div class="soltar-aqui">Solte para enviar</div>
    <div class="acoes-doc">${principal}
      ${menu ? `<div class="mais"><button class="btn btn-pequeno btn-icone" data-mais aria-label="Mais opções">${icone('reticencias')}</button><div class="mais-lista">${menu}</div></div>` : ''}
    </div>
  </li>`;
}

function fecharMenus() { $$('.mais.aberto').forEach(m => m.classList.remove('aberto')); }
function ligarMenus(raiz) {
  $$('[data-mais]', raiz).forEach(b => {
    b.onclick = ev => { ev.stopPropagation(); const m = b.closest('.mais'); const aberto = m.classList.contains('aberto'); fecharMenus(); if (!aberto) m.classList.add('aberto'); };
  });
}
document.addEventListener('click', fecharMenus);

function abaDadosColaborador(alvo, c, empresa) {
  const { campos, funcao } = estado.cache;
  const doGrupo = campos.filter(x => x.grupo === 'colaborador' && x.ativo && !x.calculado);
  const fmt = (x, v) => v === null || v === undefined || v === '' ? '<span class="muted">—</span>'
    : x.tipo === 'data' ? dataBR(v) : x.tipo === 'moeda' ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : esc(v);
  const valor = x => x.coluna_origem ? c[x.coluna_origem] : (c.dados_extras || {})[x.chave.split('.')[1]];
  const usados = new Set(SECOES_COLAB.flatMap(s => s[2]));
  const secoes = [...SECOES_COLAB, ['Outros dados', 'pasta', doGrupo.filter(x => !usados.has(x.chave.split('.')[1])).map(x => x.chave.split('.')[1])]];
  alvo.innerHTML = `<div class="cartao">
    <div class="secao-form"><h3>${icone('maleta')} Vínculo</h3><div class="ficha">
      <div><div class="r">Função</div><div class="v">${esc(funcao[c.funcao_id]?.nome || '—')}</div></div>
      <div><div class="r">Empresa</div><div class="v">${esc(empresa[c.empresa_id]?.razao_social || '—')}</div></div>
      <div><div class="r">Situação</div><div class="v">${etiqueta(c.situacao)}</div></div>
      ${c.data_desligamento ? `<div><div class="r">Desligamento</div><div class="v">${dataBR(c.data_desligamento)}</div></div>` : ''}
    </div></div>
    ${secoes.filter(s => s[2].length).map(([t, ic, nomes]) => `<div class="secao-form"><h3>${icone(ic)} ${t}</h3><div class="ficha">
      ${nomes.map(n => doGrupo.find(x => x.chave === 'colaborador.' + n)).filter(Boolean).map(x => `<div><div class="r">${esc(x.rotulo)}</div><div class="v">${fmt(x, valor(x))}</div></div>`).join('')}
    </div></div>`).join('')}
    ${podeEditar() ? `<a class="btn" href="#/editar/${c.id}">${icone('editar')} Editar dados</a>` : ''}
  </div>`;
}

function abaHistorico(alvo, c, acoes, docs) {
  const { tipo, modelo } = estado.cache;
  const ev = [{ em: c.criado_em, t: 'Cadastro criado', d: c.criado_por_email }];
  for (const a of acoes) {
    ev.push({ em: a.criado_em, t: `${tipo[a.tipo_acao]?.nome || a.tipo_acao}: documentos gerados`, d: a.criado_por_email });
    if (a.status === 'cancelada') ev.push({ em: a.atualizado_em, t: `${tipo[a.tipo_acao]?.nome}: ação cancelada`, d: a.observacao });
  }
  for (const d of docs) {
    const n = modelo[d.modelo_id]?.nome || 'Documento';
    if (d.assinado_enviado_em) ev.push({ em: d.assinado_enviado_em, t: `Assinado enviado · ${n}`, d: d.assinado_enviado_por_email });
    if (d.conferido_em) ev.push({ em: d.conferido_em, t: `Conferido · ${n}`, d: d.conferido_por_email });
  }
  ev.sort((a, b) => new Date(b.em || 0) - new Date(a.em || 0));
  alvo.innerHTML = `<div class="cartao"><ul class="linha-tempo">${ev.filter(e => e.em).map(e => `
    <li><div style="font-weight:600">${esc(e.t)}</div><div class="quando">${dataHoraBR(e.em)}${e.d ? ' · ' + esc(e.d) : ''}</div></li>`).join('')}</ul></div>`;
}

// ---------------------------------------------------------------------
// Documentos: baixar, enviar assinado, conferir
// ---------------------------------------------------------------------
function nomeArquivo(d, colab, ext) {
  return `${slug(estado.cache.modelo[d.modelo_id]?.nome || 'documento')}_${slug(colab.nome)}.${ext}`;
}

async function baixarStorage(path) {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error) throw error;
  return data;
}

async function baixarZip(acao, docs, colab) {
  try {
    aviso('Preparando arquivo…');
    const zip = new PizZip();
    let i = 0;
    for (const d of docs) {
      if (!d.arquivo_gerado_path) continue;
      const blob = await baixarStorage(d.arquivo_gerado_path);
      zip.file(`${String(++i).padStart(2, '0')}_${nomeArquivo(d, colab, 'docx')}`, await blob.arrayBuffer());
    }
    baixarBlob(zip.generate({ type: 'blob' }), `${slug(estado.cache.tipo[acao.tipo_acao]?.nome || 'acao')}_${slug(colab.nome)}.zip`);
  } catch (e) { erro(e, 'Baixar'); }
}

async function enviarAssinado(d, colab, arq) {
  try {
    if (arq.size > 20 * 1024 * 1024) throw new Error('Arquivo maior que 20 MB.');
    const ext = (arq.name.split('.').pop() || '').toLowerCase();
    const tipo = MIME_EXT[ext] || arq.type;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(tipo)) throw new Error('Envie o assinado em PDF, JPG ou PNG.');
    const path = `colaboradores/${colab.id}/${d.acao_id}/${d.id}_assinado_${Date.now()}.${ext || 'pdf'}`;
    aviso(`Enviando "${estado.cache.modelo[d.modelo_id]?.nome}"…`);
    const { error } = await sb.storage.from(BUCKET).upload(path, comTipo(arq, tipo), { contentType: tipo });
    if (error) throw error;
    await q(sb.from('documentos_gerados').update({
      status: 'assinado', arquivo_assinado_path: path, assinado_enviado_em: new Date().toISOString(),
      assinado_enviado_por: estado.sessao.user.id, assinado_enviado_por_email: estado.sessao.user.email, motivo_rejeicao: null,
    }).eq('id', d.id));
    aviso('Assinado recebido. Agora é só conferir.', 'ok');
    return true;
  } catch (e) { erro(e, 'Enviar assinado'); return false; }
}

async function verificarConclusaoAcao(acaoId) {
  const ds = await q(sb.from('documentos_gerados').select('status, obrigatorio').eq('acao_id', acaoId));
  if (ds.some(d => d.obrigatorio && !['conferido', 'dispensado'].includes(d.status))) return;
  const acao = await q(sb.from('acoes').update({ status: 'concluida' }).eq('id', acaoId).eq('status', 'gerada').select('*'));
  if (acao[0]?.tipo_acao === 'admissao') {
    await q(sb.from('colaboradores').update({ situacao: 'ativo' }).eq('id', acao[0].colaborador_id).eq('situacao', 'em_admissao'));
    aviso('Admissão concluída! O colaborador agora está ativo.', 'ok');
  } else if (acao[0]) aviso('Ação concluída.', 'ok');
}

async function acaoDocumento(tipoAcao, d, colab, depois) {
  try {
    if (tipoAcao === 'baixar') return baixarBlob(await baixarStorage(d.arquivo_gerado_path), nomeArquivo(d, colab, 'docx'));
    if (tipoAcao === 'ver-assinado') {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.arquivo_assinado_path, 300);
      if (error) throw error;
      return window.open(data.signedUrl, '_blank', 'noopener');
    }
    if (tipoAcao === 'enviar') {
      const arq = await escolherArquivo('.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png');
      if (arq && await enviarAssinado(d, colab, arq)) depois();
      return;
    }
    if (tipoAcao === 'conferir') return abrirConferencia([{ ...d, colab }], depois);
    if (tipoAcao === 'rejeitar' || tipoAcao === 'dispensar') {
      const rej = tipoAcao === 'rejeitar';
      const r = await dialogo({
        titulo: rej ? 'Rejeitar documento assinado' : 'Dispensar documento',
        corpo: `<p>${rej ? 'O documento volta para "aguardando assinatura". Qual o problema?' : 'O documento deixa de ser exigido nesta ação. Qual o motivo?'}</p>
          <div class="campo"><textarea name="motivo" required placeholder="${rej ? 'Ex.: falta a assinatura da página 2' : 'Ex.: colaborador já entregou na transferência'}"></textarea></div>`,
        botoes: [{ texto: rej ? 'Rejeitar' : 'Dispensar', valor: true, classe: 'btn-perigo' }],
      });
      if (!r.valor) return;
      await q(sb.from('documentos_gerados').update(rej
        ? { status: 'rejeitado', motivo_rejeicao: r.dados.motivo }
        : { status: 'dispensado', motivo_dispensa: r.dados.motivo }).eq('id', d.id));
      if (!rej) await verificarConclusaoAcao(d.acao_id);
      aviso(rej ? 'Documento rejeitado.' : 'Documento dispensado.', 'ok');
      depois();
    }
  } catch (e) { erro(e, 'Documento'); }
}

// ----- Conferência (fila com visualização lado a lado) -----
async function telaConferir() {
  const fila = await filaConferencia();
  const porColab = {};
  for (const d of fila) (porColab[d.colab.id] ||= { c: d.colab, ds: [] }).ds.push(d);
  app.innerHTML = `
    <div class="pagina-topo">
      <div><h1>Conferir assinaturas</h1><p class="sub">Veja cada documento assinado e aprove ou rejeite, um após o outro.</p></div>
      <div class="acoes">${fila.length && podeEditar() ? `<button class="btn btn-primario btn-grande" id="comecar">${icone('conferir')} Conferir ${plural(fila.length, 'documento', 'documentos')}</button>` : ''}</div>
    </div>
    ${fila.length ? Object.values(porColab).map(({ c, ds }) => `
      <div class="cartao"><div class="cartao-topo"><div style="display:flex;gap:12px;align-items:center">${avatar(c.nome)}<div><b>${esc(c.nome)}</b>
        <div class="muted">${plural(ds.length, 'documento', 'documentos')} a conferir</div></div></div>
        ${podeEditar() ? `<button class="btn btn-pequeno" data-conferir="${c.id}">Conferir só deste</button>` : ''}</div>
        <ul class="docs">${ds.map(d => `<li class="doc"><div class="estado cor-roxo">${icone('conferir')}</div><div class="info">
          <div class="nome">${esc(estado.cache.modelo[d.modelo_id]?.nome)}</div><div class="meta">Enviado ${quandoRelativo(d.assinado_enviado_em)}${d.assinado_enviado_por_email ? ' por ' + esc(d.assinado_enviado_por_email) : ''}</div></div></li>`).join('')}</ul>
      </div>`).join('') : `<div class="cartao vazio-bonito">${icone('checkCirculo')}<div class="titulo">Nada para conferir</div><div>Os documentos assinados enviados aparecem aqui.</div></div>`}`;
  const recarregar = () => rotear();
  $('#comecar')?.addEventListener('click', () => abrirConferencia(fila, recarregar));
  $$('[data-conferir]').forEach(b => { b.onclick = () => abrirConferencia(fila.filter(d => d.colab.id === b.dataset.conferir), recarregar); });
}

async function filaConferencia(colabId) {
  let consulta = sb.from('documentos_gerados').select('*').eq('status', 'assinado').order('assinado_enviado_em');
  if (colabId) consulta = consulta.eq('colaborador_id', colabId);
  const docs = await q(consulta);
  if (!docs.length) return [];
  const colabs = await q(sb.from('colaboradores').select('id, nome, cpf').in('id', [...new Set(docs.map(d => d.colaborador_id))]));
  const porId = Object.fromEntries(colabs.map(c => [c.id, c]));
  return docs.map(d => ({ ...d, colab: porId[d.colaborador_id] || { id: d.colaborador_id, nome: '—' } }));
}

async function conferirColaborador(colabId) {
  try {
    const fila = await filaConferencia(colabId);
    if (!fila.length) return aviso('Nada para conferir.');
    abrirConferencia(fila, () => rotear());
  } catch (e) { erro(e, 'Conferir'); }
}

function abrirConferencia(fila, aoFechar) {
  let i = 0, feitos = 0;
  const caixa = document.createElement('div');
  caixa.className = 'conferencia';
  document.body.appendChild(caixa);
  const fechar = () => { caixa.remove(); document.removeEventListener('keydown', teclas); if (feitos) aoFechar(); };
  const teclas = ev => { if (ev.key === 'Escape') fechar(); };
  document.addEventListener('keydown', teclas);

  const mostrar = async () => {
    if (i >= fila.length) {
      caixa.innerHTML = `<div class="conf-caixa" style="max-width:520px;margin:auto;flex:none;flex-direction:column;padding:34px;text-align:center">
        <div class="sucesso"><div class="marca-ok">${icone('check')}</div><h2>Conferência finalizada</h2>
        <p class="texto-2">${plural(feitos, 'documento analisado', 'documentos analisados')}.</p></div>
        <div><button class="btn btn-primario btn-grande" id="c-fechar">Fechar</button></div></div>`;
      $('#c-fechar', caixa).onclick = fechar;
      return;
    }
    const d = fila[i];
    const nome = estado.cache.modelo[d.modelo_id]?.nome || 'Documento';
    caixa.innerHTML = `<div class="conf-caixa">
      <div class="conf-visual" id="c-visual"><p class="muted">Carregando arquivo…</p></div>
      <div class="conf-painel">
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="fila">Documento ${i + 1} de ${fila.length}</span>
          <button class="btn btn-fantasma btn-icone" id="c-x" aria-label="Fechar">${icone('x')}</button></div>
        <div style="display:flex;gap:12px;align-items:center">${avatar(d.colab.nome)}<div><b>${esc(d.colab.nome)}</b><div class="muted mono">${esc(d.colab.cpf || '')}</div></div></div>
        <div><h2 style="margin:0 0 4px">${esc(nome)}</h2><div class="muted">Enviado ${dataHoraBR(d.assinado_enviado_em)}${d.assinado_enviado_por_email ? ' por ' + esc(d.assinado_enviado_por_email) : ''}</div></div>
        <ul class="conf-checklist">
          <li>${icone('check')} Todas as páginas estão presentes e legíveis</li>
          <li>${icone('check')} Assinatura do colaborador em todos os campos</li>
          <li>${icone('check')} Assinatura da empresa, quando houver</li>
          <li>${icone('check')} Datas e dados conferem com o cadastro</li>
        </ul>
        <div id="c-rejeitar" hidden><div class="campo"><label>O que está errado?</label><textarea id="c-motivo" placeholder="Ex.: falta a assinatura da página 2"></textarea></div></div>
        <div class="conf-botoes">
          <button class="btn btn-sucesso btn-grande" id="c-ok">${icone('check')} Aprovar</button>
          <button class="btn btn-perigo" id="c-rej">${icone('xCirculo')} Rejeitar</button>
          ${fila.length > 1 ? `<button class="btn btn-fantasma" id="c-pular">Pular ${icone('avancar')}</button>` : ''}
        </div>
      </div></div>`;
    $('#c-x', caixa).onclick = fechar;
    $('#c-pular', caixa)?.addEventListener('click', () => { i++; mostrar(); });
    $('#c-ok', caixa).onclick = async ev => {
      ev.currentTarget.disabled = true;
      try {
        await q(sb.from('documentos_gerados').update({
          status: 'conferido', conferido_em: new Date().toISOString(), conferido_por: estado.sessao.user.id, conferido_por_email: estado.sessao.user.email,
        }).eq('id', d.id));
        await verificarConclusaoAcao(d.acao_id);
        feitos++; i++; mostrar();
      } catch (e) { erro(e, 'Aprovar'); $('#c-ok', caixa).disabled = false; }
    };
    $('#c-rej', caixa).onclick = async () => {
      const area = $('#c-rejeitar', caixa);
      if (area.hidden) { area.hidden = false; $('#c-motivo', caixa).focus(); $('#c-rej', caixa).innerHTML = `${icone('xCirculo')} Confirmar rejeição`; return; }
      const motivo = $('#c-motivo', caixa).value.trim();
      if (!motivo) return aviso('Descreva o problema para quem vai reenviar.', 'erro');
      try {
        await q(sb.from('documentos_gerados').update({ status: 'rejeitado', motivo_rejeicao: motivo }).eq('id', d.id));
        feitos++; i++; mostrar();
      } catch (e) { erro(e, 'Rejeitar'); }
    };
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.arquivo_assinado_path, 600);
      if (error) throw error;
      const img = /\.(jpe?g|png)$/i.test(d.arquivo_assinado_path);
      const vis = $('#c-visual', caixa);
      if (vis) vis.innerHTML = img ? `<img src="${esc(data.signedUrl)}" alt="Documento assinado">` : `<iframe src="${esc(data.signedUrl)}" title="Documento assinado"></iframe>`;
    } catch (e) { const vis = $('#c-visual', caixa); if (vis) vis.innerHTML = `<p class="muted">Não foi possível abrir o arquivo: ${esc(e.message)}</p>`; }
  };
  mostrar();
}

// ---------------------------------------------------------------------
// Assistente: nova admissão / nova ação
// ---------------------------------------------------------------------
let wiz = null;

async function iniciarAssistente(colabId, tipo) {
  if (!podeEditar()) throw new Error('Sem permissão.');
  const colab = colabId ? await q(sb.from('colaboradores').select('*').eq('id', colabId).single()) : null;
  if (colab && !tipo) return escolherTipoAcao(colab);
  // continua um assistente em andamento (ex.: endereço trocado após salvar o colaborador)
  if (wiz && colab && wiz.colab.id === colab.id && wiz.tipo === tipo && wiz.passo > 0) { desenharAssistente(); return; }
  wiz = { colab: colab || { situacao: 'em_admissao', nacionalidade: 'Brasileira', dados_extras: {} }, tipo, dados: {}, excluidos: new Set(), kit: [] };
  wiz.passos = tipo === 'admissao' ? ['Colaborador', 'Contrato', 'Documentos', 'Pronto'] : ['Dados', 'Documentos', 'Pronto'];
  wiz.passo = 0;
  if (!wiz.colab.empresa_id) wiz.colab.empresa_id = estado.cache.empresas.find(e => e.ativo)?.id;
  if (colab) await carregarKitWiz();
  desenharAssistente();
}

async function carregarKitWiz() {
  wiz.kit = wiz.colab.funcao_id
    ? await q(sb.from('funcao_documentos').select('*').eq('funcao_id', wiz.colab.funcao_id).eq('tipo_acao', wiz.tipo))
    : [];
}

async function escolherTipoAcao(colab) {
  const { tipos } = estado.cache;
  const kit = colab.funcao_id ? await q(sb.from('funcao_documentos').select('tipo_acao, modelo_id').eq('funcao_id', colab.funcao_id)) : [];
  const disp = tipos.filter(t => t.ativo && kit.some(k => k.tipo_acao === t.codigo));
  app.innerHTML = `
    <a class="voltar" href="#/colaborador/${colab.id}">${icone('voltar')} ${esc(colab.nome)}</a>
    <div class="pagina-topo"><div><h1>O que você quer fazer?</h1><p class="sub">Escolha o evento. Os documentos da função ${esc(estado.cache.funcao[colab.funcao_id]?.nome || '')} são montados automaticamente.</p></div></div>
    ${disp.length ? ['admissao', 'gestao', 'demissao'].map(et => {
      const ts = disp.filter(t => t.etapa === et);
      return ts.length ? `<div class="secao-form"><h3>${{ admissao: 'Admissão', gestao: 'Durante o contrato', demissao: 'Desligamento' }[et]}</h3>
        <div class="tipos-acao">${ts.map(t => `<button class="tipo-acao" data-tipo="${t.codigo}">${iconeTipo(t.codigo)}
          <div><div class="nome">${esc(t.nome)}</div><small>${esc(DESC_TIPO[t.codigo] || '')} · ${plural(kit.filter(k => k.tipo_acao === t.codigo).length, 'documento', 'documentos')}</small></div></button>`).join('')}</div></div>` : '';
    }).join('') : `<div class="caixa-alerta atencao">${icone('alerta')}<span>Nenhum kit configurado para esta função. ${ehAdmin() ? '<a href="#/cadastros">Configure em Cadastros → Kits</a>.' : 'Peça a um administrador.'}</span></div>`}`;
  $$('[data-tipo]').forEach(b => { b.onclick = () => { location.hash = `#/acao/${colab.id}/${b.dataset.tipo}`; }; });
}

function cabecalhoAssistente(final = false) {
  const t = estado.cache.tipo[wiz.tipo]?.nome || 'Nova ação';
  const titulo = wiz.tipo === 'admissao' ? (wiz.passos[wiz.passo] === 'Colaborador' && !wiz.colab.id ? 'Nova admissão' : 'Admissão') : t;
  return `
    ${wiz.colab.id ? `<a class="voltar" href="#/colaborador/${wiz.colab.id}">${icone('voltar')} ${esc(wiz.colab.nome)}</a>` : `<a class="voltar" href="#/inicio">${icone('voltar')} Início</a>`}
    <div class="pagina-topo"><div><h1>${esc(titulo)}</h1>${wiz.colab.id ? `<p class="sub">${esc(wiz.colab.nome)} · ${esc(estado.cache.funcao[wiz.colab.funcao_id]?.nome || '')}</p>` : '<p class="sub">Cadastre a pessoa uma vez e o sistema preenche todos os documentos.</p>'}</div></div>
    <div class="passos">${wiz.passos.map((p, i) => {
      const cls = final || i < wiz.passo ? 'feito' : i === wiz.passo ? 'atual' : '';
      return `<div class="passo ${cls}"><span class="bola">${cls === 'feito' ? icone('check', 'width="15" height="15"') : i + 1}</span><span class="rotulo">${p}</span></div>`;
    }).join('')}</div>`;
}

function desenharAssistente() {
  window.scrollTo(0, 0);
  const nome = wiz.passos[wiz.passo];
  if (nome === 'Colaborador') return passoColaborador();
  if (nome === 'Contrato' || nome === 'Dados') return passoDados();
  if (nome === 'Documentos') return passoDocumentos();
  return passoGerar();
}

function passoColaborador() {
  app.innerHTML = `${cabecalhoAssistente()}
    <form id="f-wiz" class="cartao" novalidate>
      ${formColaborador(wiz.colab)}
      <div class="rodape-wizard" style="margin-top:24px">
        <a class="btn" href="${wiz.colab.id ? '#/colaborador/' + wiz.colab.id : '#/inicio'}">Cancelar</a>
        <button class="btn btn-primario btn-grande">Continuar ${icone('avancar')}</button>
      </div>
    </form>`;
  const form = $('#f-wiz');
  aplicarMascaras(form); buscaCep(form);
  form.onsubmit = async ev => {
    ev.preventDefault();
    const btn = form.querySelector('.btn-primario'); btn.disabled = true;
    const salvo = await salvarColaborador(form, wiz.colab);
    btn.disabled = false;
    if (!salvo) return;
    const mudouFuncao = salvo.funcao_id !== wiz.colab.funcao_id;
    wiz.colab = salvo;
    if (mudouFuncao || !wiz.kit.length) await carregarKitWiz();
    wiz.passo++;
    history.replaceState(null, '', `#/acao/${salvo.id}/${wiz.tipo}`);
    desenharAssistente();
  };
}

function marcadoresDoKit(kit) {
  const s = new Set();
  for (const k of kit) for (const t of estado.cache.modelo[k.modelo_id]?.ativa?.marcadores || []) s.add(t);
  return s;
}

function padroesAcao() {
  const d = wiz.dados, adm = wiz.colab.data_admissao;
  d.data_documento ||= adm || hojeISO();
  if (wiz.tipo === 'admissao') {
    d.experiencia_inicio ||= adm || '';
    d.experiencia_dias ||= '90';
    if (d.experiencia_inicio && d.experiencia_dias && !d.experiencia_fim) d.experiencia_fim = somarDias(d.experiencia_inicio, Number(d.experiencia_dias) - 1);
    d.jornada_horas_diarias ||= '8';
    d.jornada_horas_semanais ||= '44';
  }
}

function passoDados() {
  const { campo } = estado.cache;
  padroesAcao();
  const condicoes = [...new Set(wiz.kit.map(k => k.condicao_campo).filter(Boolean))];
  const kit = resolverKit(wiz.kit, wiz.dados);
  const marc = marcadoresDoKit(kit);
  const chaves = [...new Set(['acao.data_documento', ...[...marc].filter(t => t.startsWith('acao.') && !condicoes.includes(t))])];
  const campos = chaves.map(k => campo[k] || { chave: k, rotulo: k, tipo: 'texto' }).sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
  const semKit = !wiz.kit.length;

  app.innerHTML = `${cabecalhoAssistente()}
    <form id="f-wiz" class="cartao" novalidate>
      ${semKit ? `<div class="caixa-alerta atencao">${icone('alerta')}<span>Não há documentos configurados para esta função e ação. ${ehAdmin() ? '<a href="#/cadastros">Configure o kit em Cadastros</a>.' : ''}</span></div>` : ''}
      ${condicoes.length ? `<div class="secao-form"><h3>${icone('estrela')} Escolhas</h3><div class="form-grade">
        ${condicoes.map(cc => escolhasCampo(campo[cc] || { chave: cc, rotulo: cc, opcoes: [] }, wiz.dados[cc.slice(5)])).join('')}</div></div>` : ''}
      <div class="secao-form"><h3>${icone('calendario')} Informações para os documentos</h3><div class="form-grade">
        ${campos.map(x => inputCampo(x, wiz.dados[x.chave.slice(5)])).join('')}</div></div>
      <div class="rodape-wizard">
        ${wiz.passos[0] === 'Colaborador' ? `<button type="button" class="btn" id="voltar">${icone('voltar')} Voltar</button>` : `<a class="btn" href="#/colaborador/${wiz.colab.id}">Cancelar</a>`}
        <button class="btn btn-primario btn-grande" ${semKit ? 'disabled' : ''}>Continuar ${icone('avancar')}</button>
      </div>
    </form>`;
  const form = $('#f-wiz');
  const ler = () => { for (const [k, v] of new FormData(form).entries()) if (k.startsWith('acao.')) wiz.dados[k.slice(5)] = String(v).trim(); };
  // escolhas mudam o kit → redesenha mantendo o que já foi digitado
  condicoes.forEach(cc => $$(`[name="${cc}"]`, form).forEach(r => { r.onchange = () => { ler(); passoDados(); }; }));
  // fim da experiência calculado a partir do início e da duração
  const ini = form.elements['acao.experiencia_inicio'], dias = form.elements['acao.experiencia_dias'], fim = form.elements['acao.experiencia_fim'];
  const recalc = () => { if (ini?.value && dias?.value && fim) fim.value = somarDias(ini.value, Number(dias.value) - 1); };
  ini?.addEventListener('change', recalc); dias?.addEventListener('input', recalc);
  $('#voltar')?.addEventListener('click', () => { ler(); wiz.passo--; desenharAssistente(); });
  form.onsubmit = ev => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    ler(); wiz.passo++; desenharAssistente();
  };
}

function passoDocumentos() {
  const { modelo, campo } = estado.cache;
  const kit = resolverKit(wiz.kit, wiz.dados);
  const comModelo = kit.filter(k => modelo[k.modelo_id]?.ativa);
  const semModelo = kit.filter(k => !modelo[k.modelo_id]?.ativa);
  const incluidos = comModelo.filter(k => !wiz.excluidos.has(k.modelo_id));
  const dadosColab = montarDados({ colaborador: wiz.colab }).colaborador;
  const marcColab = [...marcadoresDoKit(incluidos)].filter(t => t.startsWith('colaborador.')).map(t => t.split('.')[1]);
  const faltando = marcColab.filter(n => n !== 'endereco_completo' && (dadosColab[n] === null || dadosColab[n] === undefined || dadosColab[n] === ''))
    .map(n => campo['colaborador.' + n]?.rotulo || n);
  if (marcColab.includes('endereco_completo') && !wiz.colab.endereco) faltando.push('Endereço');
  const idxColab = wiz.passos.indexOf('Colaborador');

  app.innerHTML = `${cabecalhoAssistente()}
    <div class="cartao">
      <div class="cartao-topo"><h2>${plural(incluidos.length, 'documento será gerado', 'documentos serão gerados')}</h2>
        <span class="muted">Desmarque os opcionais que não se aplicam</span></div>
      ${faltando.length ? `<div class="caixa-alerta atencao">${icone('alerta')}<span>Ficarão em branco nos documentos: <b>${faltando.map(esc).join(', ')}</b>.
        ${idxColab >= 0 ? '<button class="link-btn" id="completar">Completar cadastro</button>' : `<a href="#/editar/${wiz.colab.id}">Completar cadastro</a>`}</span></div>` : ''}
      ${semModelo.length ? `<div class="caixa-alerta info">${icone('info')}<span>Sem modelo carregado, não serão gerados: ${semModelo.map(k => esc(modelo[k.modelo_id]?.nome)).join(', ')}.</span></div>` : ''}
      ${comModelo.map(k => {
        const m = modelo[k.modelo_id], fora = wiz.excluidos.has(k.modelo_id);
        return `<label class="kit-item ${fora ? 'excluido' : ''}">
          <input type="checkbox" data-opcional="${k.modelo_id}" ${fora ? '' : 'checked'} ${k.obrigatorio ? 'disabled' : ''}>
          <div class="doc-icone">${icone('documento')}</div>
          <div class="info"><div class="nome">${esc(m.nome)}</div>
            <div class="muted" style="font-size:13px">${m.exige_assinatura ? 'Precisa de assinatura' : 'Só entrega, sem assinatura própria'}</div></div>
          ${k.obrigatorio ? '<span class="etq etq-azul sem-ponto">obrigatório</span>' : '<span class="etq etq-cinza sem-ponto">opcional</span>'}
        </label>`;
      }).join('')}
      <div class="rodape-wizard" style="margin-top:18px">
        <button type="button" class="btn" id="voltar">${icone('voltar')} Voltar</button>
        <button class="btn btn-destaque btn-grande" id="gerar" ${incluidos.length ? '' : 'disabled'}>${icone('raio')} Gerar ${plural(incluidos.length, 'documento', 'documentos')}</button>
      </div>
    </div>`;
  $$('[data-opcional]').forEach(ch => { ch.onchange = () => { ch.checked ? wiz.excluidos.delete(ch.dataset.opcional) : wiz.excluidos.add(ch.dataset.opcional); passoDocumentos(); }; });
  $('#completar')?.addEventListener('click', () => { wiz.passo = idxColab; desenharAssistente(); });
  $('#voltar').onclick = () => { wiz.passo--; desenharAssistente(); };
  $('#gerar').onclick = () => { wiz.incluidos = incluidos; wiz.passo++; desenharAssistente(); };
}

async function passoGerar() {
  const total = wiz.incluidos.length;
  app.innerHTML = `${cabecalhoAssistente()}
    <div class="cartao"><div class="gerando">${icone('raio', 'style="width:44px;height:44px;color:var(--laranja)"')}
      <h2 style="margin-top:10px">Gerando documentos…</h2>
      <div class="progresso"><div id="g-barra" style="width:0%"></div></div>
      <div class="muted" id="g-texto">Preparando</div></div></div>`;
  try {
    const dadosAcao = { ...wiz.dados };
    for (const k of Object.keys(dadosAcao)) if (dadosAcao[k] === '') delete dadosAcao[k];
    const { docs } = await gerarAcao({
      colab: wiz.colab, tipoAcao: wiz.tipo, dadosAcao, kit: wiz.incluidos,
      empresa: estado.cache.empresa[wiz.colab.empresa_id], funcao: estado.cache.funcao[wiz.colab.funcao_id],
      progresso: (n, nome) => { const b = $('#g-barra'); if (b) b.style.width = `${Math.round(n / total * 100)}%`; const t = $('#g-texto'); if (t) t.textContent = `${n} de ${total} · ${nome}`; },
    });
    const assinaveis = docs.filter(d => d.status === 'aguardando_assinatura').length;
    const colab = wiz.colab, tipo = wiz.tipo;
    app.innerHTML = `${cabecalhoAssistente(true)}
      <div class="cartao"><div class="sucesso">
        <div class="marca-ok">${icone('check')}</div>
        <h2>${plural(docs.length, 'documento pronto', 'documentos prontos')}!</h2>
        <p class="texto-2">${esc(colab.nome)} · ${esc(estado.cache.tipo[tipo]?.nome || '')}</p>
        <div class="grupo-btn" style="justify-content:center;margin-top:16px">
          <button class="btn btn-destaque btn-grande" id="baixar">${icone('download')} Baixar para imprimir (.zip)</button>
          <a class="btn btn-grande" href="#/colaborador/${colab.id}">Ir para o colaborador ${icone('avancar')}</a>
        </div>
        <div class="proximos">
          <div class="proximo"><div class="num">1</div><b>Imprima</b><div class="texto-2">Abra o .zip e imprima os ${docs.length} documentos.</div></div>
          <div class="proximo"><div class="num">2</div><b>Colha as assinaturas</b><div class="texto-2">${plural(assinaveis, 'documento precisa', 'documentos precisam')} de assinatura.</div></div>
          <div class="proximo"><div class="num">3</div><b>Envie os assinados</b><div class="texto-2">Digitalize e arraste cada PDF na página do colaborador.</div></div>
        </div>
      </div></div>`;
    wiz = null;
    const baixar = () => baixarZip({ tipo_acao: tipo }, docs, colab);
    $('#baixar').onclick = baixar;
    baixar();
  } catch (e) {
    erro(e, 'Gerar documentos');
    wiz.passo--;
    app.innerHTML = `${cabecalhoAssistente()}<div class="cartao"><div class="caixa-alerta erro">${icone('alerta')}<span>Não foi possível gerar: ${esc(e.message)}</span></div>
      <button class="btn" id="voltar">${icone('voltar')} Voltar</button></div>`;
    $('#voltar').onclick = () => desenharAssistente();
  }
}

async function gerarAcao({ colab, tipoAcao, dadosAcao, kit, empresa, funcao, progresso = () => {} }) {
  const acao = await q(sb.from('acoes').insert({
    colaborador_id: colab.id, tipo_acao: tipoAcao, funcao_id: colab.funcao_id,
    data_acao: dadosAcao.data_documento || hojeISO(), dados: dadosAcao, status: 'rascunho',
  }).select('*').single(), 'Criar ação');

  const dados = montarDados({ colaborador: colab, empresa, funcao, acao });
  const { modelo } = estado.cache;
  const docs = [];
  let n = 0;
  for (const k of [...kit].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))) {
    const m = modelo[k.modelo_id];
    const versao = m.ativa;
    progresso(n, m.nome);
    const gerado = motor.gerar(await (await baixarStorage(versao.arquivo_path)).arrayBuffer(), dados);
    const docId = crypto.randomUUID();
    const path = `colaboradores/${colab.id}/${acao.id}/${docId}_gerado.docx`;
    const { error } = await sb.storage.from(BUCKET).upload(path, comTipo(gerado, MIME_DOCX), { contentType: MIME_DOCX });
    if (error) throw new Error(`Envio de "${m.nome}": ${error.message}`);
    let validade = null;
    if (m.validade_meses) {
      const d = new Date(dados.acao.data_documento + 'T12:00:00');
      d.setMonth(d.getMonth() + m.validade_meses);
      validade = d.toISOString().slice(0, 10);
    }
    const reg = {
      id: docId, acao_id: acao.id, colaborador_id: colab.id, modelo_id: m.id, versao_id: versao.id,
      obrigatorio: k.obrigatorio, arquivo_gerado_path: path, validade_ate: validade,
      status: m.exige_assinatura ? 'aguardando_assinatura' : 'dispensado',
      motivo_dispensa: m.exige_assinatura ? null : 'Só entrega, sem assinatura própria (consta no recibo).',
    };
    await q(sb.from('documentos_gerados').insert(reg), `Registrar "${m.nome}"`);
    docs.push(reg);
    progresso(++n, m.nome);
  }
  await q(sb.from('acoes').update({ status: 'gerada', snapshot: dados }).eq('id', acao.id), 'Finalizar ação');
  return { acaoId: acao.id, docs };
}

// ---------------------------------------------------------------------
// Cadastros (admin)
// ---------------------------------------------------------------------
let abaCadastro = 'modelos';

async function telaCadastros(aba) {
  if (!ehAdmin()) throw new Error('Apenas administradores acessam os cadastros.');
  if (aba) abaCadastro = aba;
  await carregarCache();
  const abas = { modelos: 'Documentos-base', kits: 'Kits', funcoes: 'Funções', campos: 'Campos', usuarios: 'Usuários', empresas: 'Empresas' };
  app.innerHTML = `
    <div class="pagina-topo"><div><h1>Cadastros</h1><p class="sub">Configuração dos documentos, kits e acessos.</p></div></div>
    <div class="abas">${Object.entries(abas).map(([k, t]) => `<button data-aba="${k}" class="${k === abaCadastro ? 'ativa' : ''}">${t}</button>`).join('')}</div>
    <div id="aba"></div>`;
  $$('.abas button').forEach(b => { b.onclick = () => { abaCadastro = b.dataset.aba; telaCadastros(); }; });
  await ({ modelos: abaModelos, kits: abaKits, funcoes: abaFuncoes, campos: abaCampos, usuarios: abaUsuarios, empresas: abaEmpresas })[abaCadastro]($('#aba'));
}

// ----- Documentos-base -----
async function abaModelos(el) {
  const { modelos } = estado.cache;
  const sem = modelos.filter(m => m.ativo && !m.ativa).length;
  el.innerHTML = `
    <div class="pagina-topo">
      <p class="sub" style="margin:0">${modelos.length} documento(s)-base · ${sem} sem modelo carregado</p>
      <div class="acoes">
        <button class="btn" id="importar">Importar modelos padrão</button>
        <button class="btn btn-destaque" id="novo-modelo">+ Novo documento-base</button>
      </div>
    </div>
    <div class="cartao sem-pad"><div class="tabela-wrap"><table>
      <thead><tr><th>Documento</th><th>Categoria</th><th>Assinatura</th><th>Modelo ativo</th><th class="direita">Ações</th></tr></thead>
      <tbody>${modelos.map(m => `<tr>
        <td><b>${esc(m.nome)}</b>${m.ativo ? '' : ' <span class="etq etq-cinza">inativo</span>'}
          ${m.descricao ? `<div class="muted">${esc(m.descricao)}</div>` : ''}</td>
        <td>${esc({ admissao: 'Admissão', gestao: 'Gestão', demissao: 'Demissão' }[m.categoria])}</td>
        <td>${m.exige_assinatura ? 'Sim' : 'Não'}${m.validade_meses ? `<div class="muted">vence em ${m.validade_meses} meses</div>` : ''}</td>
        <td>${m.ativa ? `<span class="etq etq-verde">v${m.ativa.versao}</span> <span class="muted">${m.ativa.marcadores.length} marcador(es)</span>`
          : '<span class="etq etq-amarelo">sem modelo</span>'}</td>
        <td class="direita"><div class="grupo-btn" style="justify-content:flex-end">
          ${m.ativa ? `<button class="btn btn-pequeno" data-baixar="${m.id}">Baixar</button>` : ''}
          <button class="btn btn-pequeno btn-primario" data-versao="${m.id}">${m.ativa ? 'Nova versão' : 'Carregar .docx'}</button>
          <button class="btn btn-pequeno" data-editar="${m.id}">Editar</button>
        </div></td></tr>`).join('')}</tbody></table></div></div>
    <div class="caixa-alerta info">Nos arquivos .docx, use marcadores como <span class="mono">{colaborador.nome}</span>,
      <span class="mono">{acao.data_documento|data_extenso}</span> ou <span class="mono">{colaborador.salario|moeda}</span>.
      A lista completa está na aba Campos.</div>`;

  $('#novo-modelo').onclick = () => editarModelo(null);
  $$('[data-editar]').forEach(b => { b.onclick = () => editarModelo(estado.cache.modelo[b.dataset.editar]); });
  $$('[data-versao]').forEach(b => {
    b.onclick = async () => {
      const arq = await escolherArquivo('.docx');
      if (arq) await carregarVersao(estado.cache.modelo[b.dataset.versao], await lerArquivo(arq), arq.name);
    };
  });
  $$('[data-baixar]').forEach(b => {
    b.onclick = async () => {
      const m = estado.cache.modelo[b.dataset.baixar];
      try { baixarBlob(await baixarStorage(m.ativa.arquivo_path), `${slug(m.nome)}_v${m.ativa.versao}.docx`); }
      catch (e) { erro(e, 'Baixar modelo'); }
    };
  });
  $('#importar').onclick = importarPadrao;
}

async function editarModelo(m) {
  const r = await dialogo({
    titulo: m ? 'Editar documento-base' : 'Novo documento-base',
    corpo: `<div class="form-grade">
      <div class="campo largo"><label>Nome</label><input name="nome" required value="${esc(m?.nome || '')}"></div>
      <div class="campo"><label>Categoria</label><select name="categoria">
        ${['admissao', 'gestao', 'demissao'].map(c => `<option value="${c}" ${m?.categoria === c ? 'selected' : ''}>${{ admissao: 'Admissão', gestao: 'Gestão', demissao: 'Demissão' }[c]}</option>`).join('')}</select></div>
      <div class="campo"><label>Validade (meses)</label><input type="number" min="1" name="validade_meses" value="${esc(m?.validade_meses || '')}"><small>Em branco = não vence</small></div>
      <div class="campo largo"><label>Descrição</label><input name="descricao" value="${esc(m?.descricao || '')}"></div>
      <label class="campo"><span><input type="checkbox" name="exige_assinatura" style="width:auto" ${m ? (m.exige_assinatura ? 'checked' : '') : 'checked'}> Exige assinatura</span></label>
      <label class="campo"><span><input type="checkbox" name="ativo" style="width:auto" ${!m || m.ativo ? 'checked' : ''}> Ativo</span></label>
    </div>`,
    botoes: [{ texto: 'Salvar', valor: true, classe: 'btn-primario' }],
  });
  if (!r.valor) return;
  const reg = {
    nome: r.dados.nome.trim(), categoria: r.dados.categoria, descricao: r.dados.descricao || null,
    validade_meses: r.dados.validade_meses ? Number(r.dados.validade_meses) : null,
    exige_assinatura: !!r.dados.exige_assinatura, ativo: !!r.dados.ativo,
  };
  try {
    if (m) await q(sb.from('documentos_modelo').update(reg).eq('id', m.id));
    else await q(sb.from('documentos_modelo').insert(reg));
    aviso('Documento-base salvo.', 'ok'); telaCadastros();
  } catch (e) { erro(e, 'Salvar'); }
}

async function carregarVersao(m, conteudo, nomeArquivo, silencioso = false) {
  try {
    const marcadores = motor.listarMarcadores(conteudo);
    const desconhecidos = marcadores.filter(t => !estado.cache.campo[t]);
    if (desconhecidos.length && !silencioso) {
      const ok = await confirmar('Marcadores não cadastrados',
        `Este arquivo usa marcadores que não existem na aba Campos e sairão em branco:<br><span class="mono">${desconhecidos.map(esc).join('<br>')}</span><br><br>Carregar mesmo assim?`,
        'Carregar');
      if (!ok) return false;
    }
    // valida se o docxtemplater consegue processar o arquivo
    motor.gerar(conteudo, montarDados({}));
    const versao = (m.versoes[0]?.versao || 0) + 1;
    const path = `modelos/${m.id}/v${versao}.docx`;
    const { error } = await sb.storage.from(BUCKET).upload(path, comTipo(conteudo, MIME_DOCX), {
      contentType: MIME_DOCX, upsert: true,
    });
    if (error) throw error;
    if (m.ativa) await q(sb.from('documentos_modelo_versoes').update({ ativa: false }).eq('id', m.ativa.id));
    await q(sb.from('documentos_modelo_versoes').insert({
      modelo_id: m.id, versao, arquivo_path: path, nome_arquivo: nomeArquivo, marcadores, ativa: true,
    }));
    if (!silencioso) { aviso(`"${m.nome}" — versão ${versao} ativa.`, 'ok'); telaCadastros(); }
    return true;
  } catch (e) {
    const msg = e?.properties?.errors?.map(x => x.properties?.explanation).filter(Boolean).join('; ');
    erro(msg ? new Error(msg) : e, `Modelo "${m.nome}"`);
    return false;
  }
}

async function importarPadrao() {
  try {
    const manifest = await (await fetch('modelos/manifest.json', { cache: 'no-store' })).json();
    const pendentes = manifest.filter(i => {
      const m = estado.cache.modelos.find(x => x.nome === i.modelo);
      return m && !m.ativa;
    });
    if (!pendentes.length) return aviso('Todos os modelos padrão já estão carregados.');
    const ok = await confirmar('Importar modelos padrão',
      `Serão carregados ${pendentes.length} modelo(s) preparados a partir dos documentos da empresa:<br>${pendentes.map(p => '• ' + esc(p.modelo)).join('<br>')}`,
      'Importar');
    if (!ok) return;
    let n = 0;
    for (const i of pendentes) {
      const m = estado.cache.modelos.find(x => x.nome === i.modelo);
      const buf = await (await fetch('modelos/' + i.arquivo, { cache: 'no-store' })).arrayBuffer();
      if (await carregarVersao(m, buf, i.arquivo, true)) n++;
    }
    aviso(`${n} modelo(s) importado(s).`, 'ok');
    telaCadastros();
  } catch (e) { erro(e, 'Importar'); }
}

// ----- Kits -----
let kitSel = { funcao: '', tipo: 'admissao' };
async function abaKits(el) {
  const { funcoes, tipos, modelos, campos, modelo } = estado.cache;
  if (!kitSel.funcao && funcoes[0]) kitSel.funcao = funcoes[0].id;
  const itens = kitSel.funcao ? await q(sb.from('funcao_documentos').select('*')
    .eq('funcao_id', kitSel.funcao).eq('tipo_acao', kitSel.tipo).order('ordem')) : [];
  const camposLista = campos.filter(c => c.grupo === 'acao' && c.tipo === 'lista');
  const noKit = new Set(itens.map(i => i.modelo_id));

  el.innerHTML = `
    <div class="cartao">
      <div class="linha-form">
        <div class="campo"><label>Função</label><select id="k-funcao">${funcoes.map(f => `<option value="${f.id}" ${f.id === kitSel.funcao ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Tipo de ação</label><select id="k-tipo">${tipos.map(t => `<option value="${t.codigo}" ${t.codigo === kitSel.tipo ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="cartao sem-pad"><div class="tabela-wrap"><table>
      <thead><tr><th>Ordem</th><th>Documento</th><th>Obrigatório</th><th>Condição</th><th>Modelo</th><th></th></tr></thead>
      <tbody>${itens.length ? itens.map(i => `<tr>
        <td>${i.ordem}</td><td><b>${esc(modelo[i.modelo_id]?.nome)}</b></td>
        <td>${i.obrigatorio ? 'Sim' : 'Não'}</td>
        <td>${i.condicao_campo ? `<span class="mono">${esc(i.condicao_campo)} = ${esc(i.condicao_valor)}</span>` : '<span class="muted">sempre</span>'}</td>
        <td>${modelo[i.modelo_id]?.ativa ? '<span class="etq etq-verde">ok</span>' : '<span class="etq etq-amarelo">sem modelo</span>'}</td>
        <td class="direita"><button class="btn btn-pequeno btn-perigo" data-remover="${i.modelo_id}">Remover</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">Nenhum documento neste kit.</td></tr>'}</tbody></table></div></div>
    <form class="cartao" id="f-kit"><h3>Adicionar documento ao kit</h3>
      <div class="linha-form">
        <div class="campo" style="flex:3"><label>Documento</label><select name="modelo_id" required><option value=""></option>
          ${modelos.filter(m => m.ativo && !noKit.has(m.id)).map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join('')}</select></div>
        <div class="campo" style="max-width:90px"><label>Ordem</label><input type="number" name="ordem" value="${(itens.at(-1)?.ordem || 0) + 10}"></div>
        <div class="campo" style="max-width:130px"><label>Obrigatório</label><select name="obrigatorio"><option value="1">Sim</option><option value="0">Não</option></select></div>
        <div class="campo"><label>Só quando</label><select name="condicao_campo"><option value="">sempre</option>
          ${camposLista.map(c => `<option value="${c.chave}">${esc(c.rotulo)}</option>`).join('')}</select></div>
        <div class="campo"><label>for igual a</label><select name="condicao_valor"><option value=""></option></select></div>
        <button class="btn btn-primario">Adicionar</button>
      </div>
    </form>`;

  $('#k-funcao').onchange = e => { kitSel.funcao = e.target.value; abaKits(el); };
  $('#k-tipo').onchange = e => { kitSel.tipo = e.target.value; abaKits(el); };
  const f = $('#f-kit');
  f.condicao_campo.onchange = () => {
    const c = estado.cache.campo[f.condicao_campo.value];
    f.condicao_valor.innerHTML = c ? (c.opcoes || []).map(o => `<option value="${esc(o)}">${esc(rotuloOpcao(o))}</option>`).join('') : '<option value=""></option>';
  };
  f.onsubmit = async ev => {
    ev.preventDefault();
    try {
      await q(sb.from('funcao_documentos').insert({
        funcao_id: kitSel.funcao, tipo_acao: kitSel.tipo, modelo_id: f.modelo_id.value,
        ordem: Number(f.ordem.value || 0), obrigatorio: f.obrigatorio.value === '1',
        condicao_campo: f.condicao_campo.value || null, condicao_valor: f.condicao_campo.value ? f.condicao_valor.value : null,
      }));
      abaKits(el);
    } catch (e) { erro(e, 'Adicionar'); }
  };
  $$('[data-remover]').forEach(b => {
    b.onclick = async () => {
      if (!await confirmar('Remover do kit', 'O documento deixa de ser gerado nas próximas ações. Os já gerados não mudam.', 'Remover', 'btn-perigo')) return;
      try {
        await q(sb.from('funcao_documentos').delete().eq('funcao_id', kitSel.funcao).eq('tipo_acao', kitSel.tipo).eq('modelo_id', b.dataset.remover));
        abaKits(el);
      } catch (e) { erro(e, 'Remover'); }
    };
  });
}

// ----- Funções -----
async function abaFuncoes(el) {
  const { funcoes } = estado.cache;
  el.innerHTML = `
    <div class="cartao sem-pad"><div class="tabela-wrap"><table>
      <thead><tr><th>Função</th><th>CBO</th><th>Jornada</th><th>Situação</th><th></th></tr></thead>
      <tbody>${funcoes.map(f => `<tr><td><b>${esc(f.nome)}</b><div class="muted">${esc(f.descricao || '')}</div></td>
        <td>${esc(f.cbo || '—')}</td><td>${esc(f.jornada || '—')}</td>
        <td>${f.ativo ? '<span class="etq etq-verde">ativa</span>' : '<span class="etq etq-cinza">inativa</span>'}</td>
        <td class="direita"><button class="btn btn-pequeno" data-editar="${f.id}">Editar</button></td></tr>`).join('')}</tbody>
    </table></div></div>
    <button class="btn btn-destaque" id="nova-funcao">+ Nova função</button>`;
  const editar = async f => {
    const r = await dialogo({
      titulo: f ? 'Editar função' : 'Nova função',
      corpo: `<div class="form-grade">
        <div class="campo largo"><label>Nome</label><input name="nome" required value="${esc(f?.nome || '')}"></div>
        <div class="campo"><label>CBO</label><input name="cbo" value="${esc(f?.cbo || '')}"></div>
        <div class="campo"><label>Jornada</label><input name="jornada" value="${esc(f?.jornada || '')}"></div>
        <div class="campo largo"><label>Descrição</label><input name="descricao" value="${esc(f?.descricao || '')}"></div>
        <label class="campo"><span><input type="checkbox" name="ativo" style="width:auto" ${!f || f.ativo ? 'checked' : ''}> Ativa</span></label>
      </div>`,
      botoes: [{ texto: 'Salvar', valor: true, classe: 'btn-primario' }],
    });
    if (!r.valor) return;
    const reg = { nome: r.dados.nome.trim(), cbo: r.dados.cbo || null, jornada: r.dados.jornada || null, descricao: r.dados.descricao || null, ativo: !!r.dados.ativo };
    try {
      if (f) await q(sb.from('funcoes').update(reg).eq('id', f.id)); else await q(sb.from('funcoes').insert(reg));
      telaCadastros();
    } catch (e) { erro(e, 'Salvar'); }
  };
  $('#nova-funcao').onclick = () => editar(null);
  $$('[data-editar]').forEach(b => { b.onclick = () => editar(estado.cache.funcao[b.dataset.editar]); });
}

// ----- Campos -----
async function abaCampos(el) {
  const { campos } = estado.cache;
  const grupos = { colaborador: 'Colaborador', empresa: 'Empresa', funcao: 'Função', acao: 'Ação (preenchido a cada evento)' };
  el.innerHTML = `
    <div class="caixa-alerta info">Formatações disponíveis nos modelos: <span class="mono">|data</span>, <span class="mono">|data_extenso</span>,
      <span class="mono">|dia</span>, <span class="mono">|mes_extenso</span>, <span class="mono">|ano</span>, <span class="mono">|moeda</span>,
      <span class="mono">|extenso</span>, <span class="mono">|maiusculas</span>. Ex.: <span class="mono">{colaborador.salario|extenso}</span></div>
    ${Object.entries(grupos).map(([g, t]) => `<div class="cartao sem-pad">
      <div style="padding:14px 16px 0"><h3>${t}</h3></div>
      <div class="tabela-wrap"><table>
        <thead><tr><th>Marcador</th><th>Rótulo</th><th>Tipo</th><th>Obrigatório</th><th></th></tr></thead>
        <tbody>${campos.filter(c => c.grupo === g).map(c => `<tr>
          <td class="mono">{${esc(c.chave)}}${c.ativo ? '' : ' <span class="etq etq-cinza">inativo</span>'}</td>
          <td>${esc(c.rotulo)}${c.calculado ? ' <span class="etq etq-azul">automático</span>' : ''}</td>
          <td>${esc(c.tipo)}${c.tipo === 'lista' ? `<div class="muted">${(c.opcoes || []).map(esc).join(', ')}</div>` : ''}</td>
          <td>${c.obrigatorio ? 'Sim' : 'Não'}</td>
          <td class="direita">${c.calculado ? '' : `<button class="btn btn-pequeno" data-editar="${esc(c.chave)}">Editar</button>`}</td>
        </tr>`).join('')}</tbody></table></div></div>`).join('')}
    <button class="btn btn-destaque" id="novo-campo">+ Novo campo</button>`;

  const tipos = ['texto', 'texto_longo', 'data', 'moeda', 'numero', 'inteiro', 'cpf', 'cnpj', 'cep', 'telefone', 'email', 'lista', 'sim_nao'];
  const editar = async c => {
    const r = await dialogo({
      titulo: c ? 'Editar campo' : 'Novo campo',
      corpo: `<div class="form-grade">
        ${c ? `<div class="campo largo"><label>Marcador</label><input disabled value="{${esc(c.chave)}}"></div>` : `
        <div class="campo"><label>Grupo</label><select name="grupo"><option value="colaborador">colaborador</option><option value="acao">acao</option></select>
          <small>Campos novos de colaborador ficam em "Outros dados"</small></div>
        <div class="campo"><label>Nome (sem acento, com _)</label><input name="nome" required pattern="[a-z0-9_]+"></div>`}
        <div class="campo largo"><label>Rótulo no formulário</label><input name="rotulo" required value="${esc(c?.rotulo || '')}"></div>
        <div class="campo"><label>Tipo</label><select name="tipo" ${c?.coluna_origem ? 'disabled' : ''}>${tipos.map(t => `<option ${t === (c?.tipo || 'texto') ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="campo"><label>Opções (lista)</label><input name="opcoes" value="${esc((c?.opcoes || []).join(', '))}"><small>Separadas por vírgula</small></div>
        <div class="campo largo"><label>Ajuda</label><input name="ajuda" value="${esc(c?.ajuda || '')}"></div>
        <label class="campo"><span><input type="checkbox" name="obrigatorio" style="width:auto" ${c?.obrigatorio ? 'checked' : ''}> Obrigatório</span></label>
        <label class="campo"><span><input type="checkbox" name="ativo" style="width:auto" ${!c || c.ativo ? 'checked' : ''}> Ativo</span></label>
      </div>`,
      botoes: [{ texto: 'Salvar', valor: true, classe: 'btn-primario' }],
    });
    if (!r.valor) return;
    const reg = {
      rotulo: r.dados.rotulo.trim(), obrigatorio: !!r.dados.obrigatorio, ativo: !!r.dados.ativo, ajuda: r.dados.ajuda || null,
      opcoes: r.dados.opcoes ? r.dados.opcoes.split(',').map(s => s.trim()).filter(Boolean) : null,
    };
    if (!c?.coluna_origem && r.dados.tipo) reg.tipo = r.dados.tipo;
    try {
      if (c) await q(sb.from('campos').update(reg).eq('chave', c.chave));
      else await q(sb.from('campos').insert({ ...reg, chave: `${r.dados.grupo}.${r.dados.nome}`, ordem: 500 }));
      telaCadastros();
    } catch (e) { erro(e, 'Salvar campo'); }
  };
  $('#novo-campo').onclick = () => editar(null);
  $$('[data-editar]').forEach(b => { b.onclick = () => editar(estado.cache.campo[b.dataset.editar]); });
}

// ----- Usuários -----
async function abaUsuarios(el) {
  const lista = await q(sb.from('usuarios').select('*').order('nome'));
  el.innerHTML = `
    <div class="cartao sem-pad"><div class="tabela-wrap"><table>
      <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th></th></tr></thead>
      <tbody>${lista.map(u => `<tr><td><b>${esc(u.nome)}</b></td><td>${esc(u.email)}</td>
        <td><select data-papel="${u.user_id}" ${u.user_id === estado.sessao.user.id ? 'disabled' : ''}>
          ${['admin', 'operador', 'leitura'].map(p => `<option ${p === u.papel ? 'selected' : ''}>${p}</option>`).join('')}</select></td>
        <td>${u.ativo ? '<span class="etq etq-verde">ativo</span>' : '<span class="etq etq-cinza">bloqueado</span>'}</td>
        <td class="direita">${u.user_id === estado.sessao.user.id ? '<span class="muted">você</span>'
          : `<button class="btn btn-pequeno" data-ativo="${u.user_id}" data-v="${u.ativo ? 0 : 1}">${u.ativo ? 'Bloquear' : 'Reativar'}</button>`}</td></tr>`).join('')}</tbody>
    </table></div></div>
    <form class="cartao" id="f-usuario"><h3>Liberar acesso</h3>
      <p class="muted" style="margin-top:0">O login (e-mail e senha) precisa existir antes no Supabase, em Authentication → Users → Add user.</p>
      <div class="linha-form">
        <div class="campo"><label>E-mail</label><input type="email" name="email" required></div>
        <div class="campo"><label>Nome</label><input name="nome" required></div>
        <div class="campo" style="max-width:160px"><label>Papel</label><select name="papel">
          <option value="operador">operador</option><option value="leitura">leitura</option><option value="admin">admin</option></select></div>
        <button class="btn btn-primario">Liberar</button>
      </div>
      <p class="muted"><b>admin</b>: tudo, inclusive cadastros · <b>operador</b>: colaboradores, ações e documentos · <b>leitura</b>: só consulta</p>
    </form>`;
  $('#f-usuario').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const { error } = await sb.rpc('liberar_usuario', { p_email: f.get('email'), p_nome: f.get('nome'), p_papel: f.get('papel') });
    if (error) return erro(error, 'Liberar');
    aviso('Acesso liberado.', 'ok'); abaUsuarios(el);
  };
  $$('[data-papel]').forEach(s => {
    s.onchange = async () => {
      try { await q(sb.from('usuarios').update({ papel: s.value }).eq('user_id', s.dataset.papel)); aviso('Papel alterado.', 'ok'); }
      catch (e) { erro(e, 'Papel'); }
    };
  });
  $$('[data-ativo]').forEach(b => {
    b.onclick = async () => {
      try { await q(sb.from('usuarios').update({ ativo: b.dataset.v === '1' }).eq('user_id', b.dataset.ativo)); abaUsuarios(el); }
      catch (e) { erro(e, 'Situação'); }
    };
  });
}

// ----- Empresas -----
async function abaEmpresas(el) {
  const { empresas } = estado.cache;
  const cols = [['razao_social', 'Razão social', 1], ['nome_fantasia', 'Nome fantasia'], ['cnpj', 'CNPJ', 1], ['inscricao_estadual', 'Inscrição estadual'],
    ['endereco', 'Logradouro'], ['numero', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro'], ['cidade', 'Cidade'], ['uf', 'UF'],
    ['cep', 'CEP'], ['telefone', 'Telefone'], ['email', 'E-mail'], ['responsavel_nome', 'Responsável'], ['responsavel_cpf', 'CPF do responsável'],
    ['responsavel_cargo', 'Cargo do responsável']];
  el.innerHTML = empresas.map(e => `
    <form class="cartao" data-empresa="${e.id}">
      <h3>${esc(e.razao_social)} ${e.ativo ? '' : '<span class="etq etq-cinza">inativa</span>'}</h3>
      <div class="form-grade">${cols.map(([k, t, ob]) => `<div class="campo"><label>${t}</label>
        <input name="${k}" value="${esc(e[k] || '')}" ${ob ? 'required' : ''}></div>`).join('')}
        <label class="campo"><span><input type="checkbox" name="ativo" style="width:auto" ${e.ativo ? 'checked' : ''}> Ativa</span></label>
      </div>
      <div class="rodape-form"><button class="btn btn-primario">Salvar</button></div>
    </form>`).join('');
  $$('form[data-empresa]').forEach(f => {
    f.onsubmit = async ev => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      const reg = Object.fromEntries(cols.map(([k]) => [k, (d[k] || '').trim() || null]));
      reg.ativo = f.ativo.checked;
      if (reg.uf) reg.uf = reg.uf.toUpperCase().slice(0, 2);
      try { await q(sb.from('empresas').update(reg).eq('id', f.dataset.empresa)); aviso('Empresa salva.', 'ok'); await carregarCache(); }
      catch (e) { erro(e, 'Salvar empresa'); }
    };
  });
}

// ---------------------------------------------------------------------
iniciarSessao();
