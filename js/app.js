// vendor.js: supabase-js 2.119, docxtemplater 3.71, pizzip 3.3, angular-expressions 1.7 (empacotados com esbuild)
import { createClient, Docxtemplater, PizZip, expressions } from './vendor.js';
import { SUPABASE_URL, SUPABASE_CHAVE, SCHEMA, BUCKET } from './config.js';
import { criarMotor, montarDados, resolverKit } from './motor.js';
import {
  esc, $, $$, aviso, erro, dataBR, dataHoraBR, hojeISO, slug, baixarBlob, lerArquivo,
  escolherArquivo, dialogo, confirmar, etiqueta,
} from './util.js';

const sb = createClient(SUPABASE_URL, SUPABASE_CHAVE, { db: { schema: SCHEMA } });
const motor = criarMotor({ Docxtemplater, PizZip, expressions });
const app = $('#app');

// ---------------------------------------------------------------------
// Estado e cache de cadastros
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

// ---------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------
function telaLogin(msg = '') {
  msg = msg || estado.msgLogin; estado.msgLogin = '';
  $('#topo').hidden = true;
  app.innerHTML = `
    <div class="login-wrap"><div class="cartao login">
      <div class="marca-login"><b>BARRETO</b><div>Gestão Trabalhista</div></div>
      ${msg ? `<div class="alerta-caixa erro">${esc(msg)}</div>` : ''}
      <form id="f-login">
        <div class="campo"><label>E-mail</label><input type="email" name="email" required autocomplete="username"></div>
        <div class="campo"><label>Senha</label><input type="password" name="senha" required autocomplete="current-password"></div>
        <button class="btn btn-primario">Entrar</button>
        <button type="button" class="btn-link" id="esqueci">Esqueci minha senha</button>
      </form>
    </div></div>`;
  $('#f-login').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector('.btn-primario');
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('senha') });
    btn.disabled = false;
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
  $('#topo').hidden = true;
  app.innerHTML = `
    <div class="login-wrap"><div class="cartao login">
      <div class="marca-login"><b>BARRETO</b><div>Nova senha</div></div>
      <form id="f-senha">
        <div class="campo"><label>Nova senha</label><input type="password" name="s1" minlength="8" required autocomplete="new-password"></div>
        <div class="campo"><label>Repita a senha</label><input type="password" name="s2" minlength="8" required autocomplete="new-password"></div>
        <button class="btn btn-primario">Salvar senha</button>
      </form>
    </div></div>`;
  $('#f-senha').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    if (f.get('s1') !== f.get('s2')) return aviso('As senhas não conferem.', 'erro');
    const { error } = await sb.auth.updateUser({ password: f.get('s1') });
    if (error) return erro(error, 'Nova senha');
    aviso('Senha alterada.', 'ok');
    location.hash = '#/painel';
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
  $('#topo').hidden = false;
  $('#usuario-nome').textContent = `${estado.usuario.nome} · ${estado.usuario.papel}`;
  $$('#menu [data-admin]').forEach(a => { a.hidden = !ehAdmin(); });
  rotear();
}

$('#sair').onclick = async () => { await sb.auth.signOut(); location.hash = ''; };

// Chamadas ao Supabase dentro do callback são adiadas (evita travamento do cliente de autenticação)
sb.auth.onAuthStateChange((evento, sessao) => {
  if (evento === 'PASSWORD_RECOVERY') { setTimeout(telaNovaSenha, 0); return; }
  if (evento === 'SIGNED_IN' && !estado.sessao) setTimeout(iniciarSessao, 0);
  if (evento === 'SIGNED_OUT') { estado.sessao = null; estado.usuario = null; setTimeout(() => { if (!$('#f-login')) telaLogin(); }, 0); }
  if (sessao) estado.sessao = sessao;
});

// ---------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------
const ROTAS = {
  painel: telaPainel,
  colaboradores: telaColaboradores,
  colaborador: telaColaborador,
  'colaborador-editar': telaColaboradorForm,
  'nova-acao': telaNovaAcao,
  cadastros: telaCadastros,
};

async function rotear() {
  if (!estado.usuario) return;
  const [rota, ...args] = (location.hash.replace(/^#\/?/, '') || 'painel').split('/');
  $$('#menu a').forEach(a => a.classList.toggle('ativo',
    a.dataset.rota === rota || (rota.startsWith('colaborador') && a.dataset.rota === 'colaboradores') ||
    (rota === 'nova-acao' && a.dataset.rota === 'colaboradores')));
  const fn = ROTAS[rota] || telaPainel;
  app.innerHTML = '<p class="carregando">Carregando…</p>';
  try { await fn(...args.map(decodeURIComponent)); }
  catch (e) { erro(e); app.innerHTML = `<div class="alerta-caixa erro">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', rotear);

// ---------------------------------------------------------------------
// Painel de conformidade
// ---------------------------------------------------------------------
async function telaPainel() {
  const linhas = await q(sb.from('painel_conformidade').select('*').order('nome'));
  const ativos = linhas.filter(l => l.situacao !== 'desligado');
  const soma = k => ativos.reduce((s, l) => s + Number(l[k] || 0), 0);
  const pend = soma('pendentes_assinatura'), conf = soma('aguardando_conferencia');
  const venc = soma('vencidos'), falt = soma('admissao_nao_gerados');
  const semModelo = estado.cache.modelos.filter(m => m.ativo && !m.ativa).length;

  app.innerHTML = `
    <div class="cabecalho">
      <div><h1>Painel de conformidade</h1><p class="sub">Situação dos documentos dos colaboradores ativos.</p></div>
      <div class="acoes">${podeEditar() ? '<a class="btn btn-destaque" href="#/colaborador-editar/novo">+ Novo colaborador</a>' : ''}</div>
    </div>
    ${semModelo && ehAdmin() ? `<div class="alerta-caixa atencao">${semModelo} documento(s)-base ainda sem modelo (.docx) carregado.
      <a href="#/cadastros">Ir para Cadastros</a></div>` : ''}
    <div class="grade-numeros">
      <div class="numero"><div class="valor">${ativos.length}</div><div class="rotulo">Colaboradores</div></div>
      <div class="numero ${pend ? 'atencao' : 'ok'}"><div class="valor">${pend}</div><div class="rotulo">Aguardando assinatura</div></div>
      <div class="numero ${conf ? 'atencao' : 'ok'}"><div class="valor">${conf}</div><div class="rotulo">Assinados a conferir</div></div>
      <div class="numero ${venc ? 'alerta' : 'ok'}"><div class="valor">${venc}</div><div class="rotulo">Vencidos</div></div>
      <div class="numero ${falt ? 'alerta' : 'ok'}"><div class="valor">${falt}</div><div class="rotulo">Kit de admissão não gerado</div></div>
    </div>
    <div class="cartao" style="padding:0">
      <div class="tabela-wrap"><table>
        <thead><tr><th>Colaborador</th><th>Função</th><th>Situação</th>
          <th class="num">Pendentes</th><th class="num">A conferir</th><th class="num">Conferidos</th>
          <th class="num">Vencidos</th><th class="num">Admissão faltando</th><th>Próx. vencimento</th></tr></thead>
        <tbody>${linhas.length ? linhas.map(l => `
          <tr class="clicavel" data-id="${l.colaborador_id}">
            <td><b>${esc(l.nome)}</b><div class="muted mono">${esc(l.cpf)}</div></td>
            <td>${esc(l.funcao || '—')}</td><td>${etiqueta(l.situacao)}</td>
            <td class="num">${l.pendentes_assinatura || ''}</td>
            <td class="num">${l.aguardando_conferencia || ''}</td>
            <td class="num">${l.conferidos || ''}</td>
            <td class="num">${l.vencidos ? `<span class="etq etq-vermelho">${l.vencidos}</span>` : ''}</td>
            <td class="num">${l.admissao_nao_gerados ? `<span class="etq etq-amarelo">${l.admissao_nao_gerados}</span>` : ''}</td>
            <td>${dataBR(l.proximo_vencimento)}</td>
          </tr>`).join('') : '<tr><td colspan="9" class="vazio">Nenhum colaborador cadastrado ainda.</td></tr>'}
        </tbody></table></div>
    </div>`;
  $$('tr[data-id]').forEach(tr => { tr.onclick = () => { location.hash = '#/colaborador/' + tr.dataset.id; }; });
}

// ---------------------------------------------------------------------
// Colaboradores
// ---------------------------------------------------------------------
async function telaColaboradores() {
  const lista = await q(sb.from('colaboradores').select('id, nome, cpf, situacao, funcao_id, data_admissao').order('nome'));
  app.innerHTML = `
    <div class="cabecalho">
      <div><h1>Colaboradores</h1><p class="sub">${lista.length} cadastrado(s)</p></div>
      <div class="acoes">${podeEditar() ? '<a class="btn btn-destaque" href="#/colaborador-editar/novo">+ Novo colaborador</a>' : ''}</div>
    </div>
    <div class="cartao">
      <div class="linha-form" style="margin-bottom:12px">
        <div class="campo"><label>Buscar</label><input id="busca" placeholder="Nome ou CPF"></div>
        <div class="campo" style="max-width:220px"><label>Situação</label>
          <select id="f-sit"><option value="">Todas</option>
            <option value="em_admissao">Em admissão</option><option value="ativo">Ativo</option>
            <option value="afastado">Afastado</option><option value="desligado">Desligado</option></select></div>
      </div>
      <div class="tabela-wrap"><table>
        <thead><tr><th>Nome</th><th>CPF</th><th>Função</th><th>Admissão</th><th>Situação</th></tr></thead>
        <tbody id="corpo"></tbody></table></div>
    </div>`;
  const desenhar = () => {
    const t = $('#busca').value.toLowerCase().trim(), s = $('#f-sit').value;
    const f = lista.filter(c => (!s || c.situacao === s) &&
      (!t || c.nome.toLowerCase().includes(t) || (c.cpf || '').replace(/\D/g, '').includes(t.replace(/\D/g, '') || '§')));
    $('#corpo').innerHTML = f.length ? f.map(c => `
      <tr class="clicavel" data-id="${c.id}"><td><b>${esc(c.nome)}</b></td><td class="mono">${esc(c.cpf)}</td>
        <td>${esc(estado.cache.funcao[c.funcao_id]?.nome || '—')}</td><td>${dataBR(c.data_admissao)}</td>
        <td>${etiqueta(c.situacao)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="vazio">Nenhum colaborador encontrado.</td></tr>';
    $$('#corpo tr[data-id]').forEach(tr => { tr.onclick = () => { location.hash = '#/colaborador/' + tr.dataset.id; }; });
  };
  $('#busca').oninput = desenhar; $('#f-sit').onchange = desenhar;
  desenhar();
}

function inputCampo(c, valor, nome = c.chave) {
  const obrig = c.obrigatorio ? 'required' : '';
  const v = valor ?? '';
  let inp;
  switch (c.tipo) {
    case 'data': inp = `<input type="date" name="${nome}" value="${esc(v)}" ${obrig}>`; break;
    case 'moeda': inp = `<input type="number" step="0.01" min="0" name="${nome}" value="${esc(v)}" ${obrig}>`; break;
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
    default: inp = `<input type="text" name="${nome}" value="${esc(v)}" ${obrig}
      ${c.tipo === 'cpf' ? 'placeholder="000.000.000-00" inputmode="numeric"' : ''}
      ${c.tipo === 'cnpj' ? 'placeholder="00.000.000/0000-00" inputmode="numeric"' : ''}
      ${c.tipo === 'cep' ? 'placeholder="00000-000" inputmode="numeric"' : ''}
      ${c.tipo === 'telefone' ? 'placeholder="(15) 90000-0000" inputmode="tel"' : ''}>`;
  }
  return `<div class="campo ${c.tipo === 'texto_longo' ? 'largo' : ''}">
    <label>${esc(c.rotulo)}${c.obrigatorio ? ' <span class="obrig">*</span>' : ''}</label>${inp}
    ${c.ajuda ? `<small>${esc(c.ajuda)}</small>` : ''}</div>`;
}

const ROTULOS_OPCAO = { indeterminado: 'Prazo indeterminado', experiencia: 'Contrato de experiência',
  opta: 'Opta pelo plano', nao_opta: 'Não opta pelo plano' };
const rotuloOpcao = o => ROTULOS_OPCAO[o] || o;

function mascaras(raiz) {
  const fmt = {
    cpf: d => d.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'),
    cep: d => d.slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2'),
    telefone: d => d.slice(0, 11).replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4,5})(\d{4})$/, '$1-$2'),
  };
  for (const [tipo, f] of Object.entries(fmt)) {
    $$(`input[data-mask=${tipo}]`, raiz).forEach(inp => {
      inp.addEventListener('input', () => { inp.value = f(inp.value.replace(/\D/g, '')); });
    });
  }
}

async function telaColaboradorForm(id) {
  if (!podeEditar()) throw new Error('Sem permissão para editar colaboradores.');
  const novo = id === 'novo';
  const c = novo ? { situacao: 'em_admissao', nacionalidade: 'Brasileira', dados_extras: {} }
    : (await q(sb.from('colaboradores').select('*').eq('id', id).single()));
  const { campos, funcoes, empresas } = estado.cache;
  const doGrupo = campos.filter(x => x.grupo === 'colaborador' && x.ativo && !x.calculado);
  const empresasAtivas = empresas.filter(e => e.ativo || e.id === c.empresa_id);
  const valor = x => x.coluna_origem ? c[x.coluna_origem] : (c.dados_extras || {})[x.chave.split('.')[1]];

  const secoes = [
    ['Identificação', ['nome', 'cpf', 'rg', 'rg_orgao', 'data_nascimento', 'estado_civil', 'nacionalidade']],
    ['Documentos', ['pis', 'ctps_numero', 'ctps_serie', 'cnh_numero', 'cnh_categoria', 'cnh_validade']],
    ['Contato e endereço', ['telefone', 'email', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep']],
    ['Contrato', ['data_admissao', 'salario']],
  ];
  const usados = new Set(secoes.flatMap(s => s[1]));
  const extras = doGrupo.filter(x => !usados.has(x.chave.split('.')[1]));
  const html = (nomes) => nomes.map(n => doGrupo.find(x => x.chave === 'colaborador.' + n)).filter(Boolean)
    .map(x => inputCampo(x, valor(x))).join('');

  app.innerHTML = `
    <div class="cabecalho"><div><h1>${novo ? 'Novo colaborador' : esc(c.nome)}</h1>
      <p class="sub">${novo ? 'Cadastre os dados uma vez; eles preenchem todos os documentos.' : 'Editar dados cadastrais'}</p></div></div>
    <form id="f-colab" class="cartao">
      <fieldset><legend>Vínculo</legend><div class="form-grade">
        <div class="campo"><label>Empresa <span class="obrig">*</span></label><select name="empresa_id" required>
          ${empresasAtivas.map(e => `<option value="${e.id}" ${e.id === c.empresa_id ? 'selected' : ''}>${esc(e.razao_social)}</option>`).join('')}</select></div>
        <div class="campo"><label>Função <span class="obrig">*</span></label><select name="funcao_id" required><option value=""></option>
          ${funcoes.filter(f => f.ativo || f.id === c.funcao_id).map(f => `<option value="${f.id}" ${f.id === c.funcao_id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Situação</label><select name="situacao">
          ${['em_admissao', 'ativo', 'afastado', 'desligado'].map(s => `<option value="${s}" ${s === c.situacao ? 'selected' : ''}>${{ em_admissao: 'Em admissão', ativo: 'Ativo', afastado: 'Afastado', desligado: 'Desligado' }[s]}</option>`).join('')}</select></div>
        <div class="campo"><label>Data de desligamento</label><input type="date" name="data_desligamento" value="${esc(c.data_desligamento || '')}"></div>
      </div></fieldset>
      ${secoes.map(([t, n]) => `<fieldset><legend>${t}</legend><div class="form-grade">${html(n)}</div></fieldset>`).join('')}
      ${extras.length ? `<fieldset><legend>Outros dados</legend><div class="form-grade">${extras.map(x => inputCampo(x, valor(x))).join('')}</div></fieldset>` : ''}
      <div class="rodape-form">
        <a class="btn" href="${novo ? '#/colaboradores' : '#/colaborador/' + c.id}">Cancelar</a>
        <button class="btn btn-primario">Salvar</button>
      </div>
    </form>`;
  $$('input[name="colaborador.cpf"]').forEach(i => { i.dataset.mask = 'cpf'; });
  $$('input[name="colaborador.cep"]').forEach(i => { i.dataset.mask = 'cep'; });
  $$('input[name="colaborador.telefone"]').forEach(i => { i.dataset.mask = 'telefone'; });
  mascaras(app);

  $('#f-colab').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const reg = {
      empresa_id: f.get('empresa_id'), funcao_id: f.get('funcao_id') || null,
      situacao: f.get('situacao'), data_desligamento: f.get('data_desligamento') || null,
      dados_extras: { ...(c.dados_extras || {}) },
    };
    for (const x of doGrupo) {
      let v = f.get(x.chave);
      if (v === null) continue;
      v = String(v).trim();
      const val = v === '' ? null : (['moeda', 'numero', 'inteiro'].includes(x.tipo) ? Number(v) : v);
      if (x.coluna_origem) reg[x.coluna_origem] = val;
      else reg.dados_extras[x.chave.split('.')[1]] = val;
    }
    if (reg.uf) reg.uf = reg.uf.toUpperCase().slice(0, 2);
    const btn = ev.target.querySelector('.btn-primario'); btn.disabled = true;
    try {
      const salvo = novo
        ? await q(sb.from('colaboradores').insert(reg).select('id').single())
        : await q(sb.from('colaboradores').update(reg).eq('id', c.id).select('id').single());
      aviso('Colaborador salvo.', 'ok');
      location.hash = '#/colaborador/' + salvo.id;
    } catch (e) {
      btn.disabled = false;
      erro(/colaboradores_cpf_key/.test(e.message) ? new Error('Já existe colaborador com este CPF.') : e, 'Salvar');
    }
  };
}

async function telaColaborador(id) {
  const [c, acoes, docs] = await Promise.all([
    q(sb.from('colaboradores').select('*').eq('id', id).single()),
    q(sb.from('acoes').select('*').eq('colaborador_id', id).order('criado_em', { ascending: false })),
    q(sb.from('documentos_gerados').select('*').eq('colaborador_id', id)),
  ]);
  const { funcao, empresa, tipo, modelo } = estado.cache;
  const docsPorAcao = a => docs.filter(d => d.acao_id === a.id)
    .sort((x, y) => (modelo[x.modelo_id]?.nome || '').localeCompare(modelo[y.modelo_id]?.nome || ''));

  app.innerHTML = `
    <div class="cabecalho">
      <div><h1>${esc(c.nome)}</h1>
        <p class="sub">${esc(funcao[c.funcao_id]?.nome || 'Sem função')} · ${esc(empresa[c.empresa_id]?.razao_social || '')}
          · CPF <span class="mono">${esc(c.cpf)}</span> · Admissão ${dataBR(c.data_admissao)} · ${etiqueta(c.situacao)}</p></div>
      <div class="acoes">${podeEditar() ? `
        <a class="btn" href="#/colaborador-editar/${c.id}">Editar dados</a>
        <a class="btn btn-destaque" href="#/nova-acao/${c.id}">+ Nova ação</a>` : ''}</div>
    </div>
    ${acoes.length ? acoes.map(a => {
      const ds = docsPorAcao(a);
      const ok = ds.filter(d => ['conferido', 'dispensado'].includes(d.status)).length;
      return `<div class="cartao">
        <div class="cabecalho" style="margin-bottom:8px">
          <div><h2 style="margin:0">${esc(tipo[a.tipo_acao]?.nome || a.tipo_acao)} ${etiqueta(a.status)}</h2>
            <span class="muted">Data ${dataBR(a.data_acao)} · ${ok}/${ds.length} documento(s) concluídos · por ${esc(a.criado_por_email || '—')}</span></div>
          <div class="grupo-btn">
            ${ds.length ? `<button class="btn btn-pequeno" data-zip="${a.id}">Baixar todos (.zip)</button>` : ''}
            ${podeEditar() && a.status !== 'cancelada' && a.status !== 'concluida' ? `<button class="btn btn-pequeno btn-perigo" data-cancelar="${a.id}">Cancelar ação</button>` : ''}
          </div>
        </div>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Documento</th><th>Situação</th><th>Assinado</th><th class="direita">Ações</th></tr></thead>
          <tbody>${ds.map(d => linhaDoc(d)).join('') || '<tr><td colspan="4" class="vazio">Nenhum documento.</td></tr>'}</tbody>
        </table></div>
      </div>`;
    }).join('') : `<div class="cartao vazio">Nenhuma ação registrada.${podeEditar() ? ` <a href="#/nova-acao/${c.id}">Iniciar admissão</a>` : ''}</div>`}`;

  const porId = Object.fromEntries(docs.map(d => [d.id, d]));
  $$('[data-doc-acao]').forEach(b => {
    b.onclick = () => acaoDocumento(b.dataset.docAcao, porId[b.dataset.doc], c, acoes.find(a => a.id === porId[b.dataset.doc].acao_id));
  });
  $$('[data-zip]').forEach(b => { b.onclick = () => baixarZip(acoes.find(a => a.id === b.dataset.zip), docsPorAcao({ id: b.dataset.zip }), c); });
  $$('[data-cancelar]').forEach(b => {
    b.onclick = async () => {
      const r = await dialogo({
        titulo: 'Cancelar ação',
        corpo: '<p>Os documentos já gerados continuam arquivados. Informe o motivo:</p><div class="campo"><textarea name="motivo" required></textarea></div>',
        botoes: [{ texto: 'Cancelar ação', valor: true, classe: 'btn-perigo' }],
      });
      if (!r.valor) return;
      try {
        await q(sb.from('acoes').update({ status: 'cancelada', observacao: r.dados.motivo }).eq('id', b.dataset.cancelar));
        aviso('Ação cancelada.', 'ok'); rotear();
      } catch (e) { erro(e, 'Cancelar'); }
    };
  });
}

function linhaDoc(d) {
  const m = estado.cache.modelo[d.modelo_id];
  const v = m?.versoes.find(x => x.id === d.versao_id);
  const b = (acao, texto, classe = '') => `<button class="btn btn-pequeno ${classe}" data-doc="${d.id}" data-doc-acao="${acao}">${texto}</button>`;
  const botoes = [];
  if (d.arquivo_gerado_path) botoes.push(b('baixar', 'Baixar'));
  if (d.arquivo_assinado_path) botoes.push(b('ver-assinado', 'Ver assinado'));
  if (podeEditar()) {
    if (['gerado', 'aguardando_assinatura', 'rejeitado'].includes(d.status)) botoes.push(b('enviar', 'Enviar assinado', 'btn-primario'));
    if (d.status === 'assinado') { botoes.push(b('conferir', 'Conferir', 'btn-primario')); botoes.push(b('rejeitar', 'Rejeitar', 'btn-perigo')); }
    if (!['conferido', 'dispensado'].includes(d.status)) botoes.push(b('dispensar', 'Dispensar'));
  }
  const obs = d.status === 'rejeitado' ? `<div class="muted">Motivo: ${esc(d.motivo_rejeicao || '')}</div>`
    : d.status === 'dispensado' ? `<div class="muted">${esc(d.motivo_dispensa || '')}</div>` : '';
  return `<tr>
    <td><b>${esc(m?.nome || 'Documento')}</b>${d.obrigatorio ? '' : ' <span class="etq etq-cinza">opcional</span>'}
      <div class="muted">v${v?.versao ?? '?'} · gerado ${dataHoraBR(d.gerado_em)}${d.validade_ate ? ' · vence ' + dataBR(d.validade_ate) : ''}</div></td>
    <td>${etiqueta(d.status)}${obs}</td>
    <td>${d.assinado_enviado_em ? dataHoraBR(d.assinado_enviado_em) + `<div class="muted">${esc(d.assinado_enviado_por_email || '')}</div>` : '—'}
      ${d.conferido_em ? `<div class="muted">conferido ${dataHoraBR(d.conferido_em)}</div>` : ''}</td>
    <td class="direita"><div class="grupo-btn" style="justify-content:flex-end">${botoes.join('')}</div></td>
  </tr>`;
}

function nomeArquivo(d, colab, ext) {
  const m = estado.cache.modelo[d.modelo_id];
  return `${slug(m?.nome || 'documento')}_${slug(colab.nome)}.${ext}`;
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
    for (const d of docs) {
      if (!d.arquivo_gerado_path) continue;
      const blob = await baixarStorage(d.arquivo_gerado_path);
      zip.file(nomeArquivo(d, colab, 'docx'), await blob.arrayBuffer());
    }
    const nome = `${slug(estado.cache.tipo[acao.tipo_acao]?.nome || 'acao')}_${slug(colab.nome)}.zip`;
    baixarBlob(zip.generate({ type: 'blob' }), nome);
  } catch (e) { erro(e, 'Baixar'); }
}

async function verificarConclusaoAcao(acaoId) {
  const ds = await q(sb.from('documentos_gerados').select('status, obrigatorio').eq('acao_id', acaoId));
  const pend = ds.some(d => d.obrigatorio && !['conferido', 'dispensado'].includes(d.status));
  if (pend) return;
  const acao = await q(sb.from('acoes').update({ status: 'concluida' }).eq('id', acaoId).eq('status', 'gerada').select('*'));
  // admissão concluída: colaborador passa de "em admissão" para "ativo"
  if (acao[0]?.tipo_acao === 'admissao') {
    await q(sb.from('colaboradores').update({ situacao: 'ativo' }).eq('id', acao[0].colaborador_id).eq('situacao', 'em_admissao'));
    aviso('Admissão concluída: colaborador agora está ativo.', 'ok');
  }
}

async function acaoDocumento(tipoAcao, d, colab) {
  const quem = { id: estado.sessao.user.id, email: estado.sessao.user.email };
  try {
    if (tipoAcao === 'baixar') {
      baixarBlob(await baixarStorage(d.arquivo_gerado_path), nomeArquivo(d, colab, 'docx'));
      return;
    }
    if (tipoAcao === 'ver-assinado') {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.arquivo_assinado_path, 300);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener');
      return;
    }
    if (tipoAcao === 'enviar') {
      const arq = await escolherArquivo('.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png');
      if (!arq) return;
      if (arq.size > 20 * 1024 * 1024) throw new Error('Arquivo maior que 20 MB.');
      const ext = (arq.name.split('.').pop() || 'pdf').toLowerCase();
      const path = `colaboradores/${colab.id}/${d.acao_id}/${d.id}_assinado_${Date.now()}.${ext}`;
      aviso('Enviando…');
      const { error } = await sb.storage.from(BUCKET).upload(path, arq, { contentType: arq.type || undefined });
      if (error) throw error;
      await q(sb.from('documentos_gerados').update({
        status: 'assinado', arquivo_assinado_path: path, assinado_enviado_em: new Date().toISOString(),
        assinado_enviado_por: quem.id, assinado_enviado_por_email: quem.email, motivo_rejeicao: null,
      }).eq('id', d.id));
      aviso('Documento assinado enviado. Falta conferir.', 'ok');
    }
    if (tipoAcao === 'conferir') {
      const ok = await confirmar('Conferir documento', 'Confirma que o arquivo enviado está completo, legível e com todas as assinaturas?', 'Conferido');
      if (!ok) return;
      await q(sb.from('documentos_gerados').update({
        status: 'conferido', conferido_em: new Date().toISOString(), conferido_por: quem.id, conferido_por_email: quem.email,
      }).eq('id', d.id));
      await verificarConclusaoAcao(d.acao_id);
      aviso('Documento conferido.', 'ok');
    }
    if (tipoAcao === 'rejeitar' || tipoAcao === 'dispensar') {
      const rej = tipoAcao === 'rejeitar';
      const r = await dialogo({
        titulo: rej ? 'Rejeitar documento assinado' : 'Dispensar documento',
        corpo: `<p>${rej ? 'O documento volta para "enviar assinado". Informe o problema:' : 'O documento deixa de ser exigido nesta ação. Informe o motivo:'}</p>
          <div class="campo"><textarea name="motivo" required></textarea></div>`,
        botoes: [{ texto: rej ? 'Rejeitar' : 'Dispensar', valor: true, classe: 'btn-perigo' }],
      });
      if (!r.valor) return;
      await q(sb.from('documentos_gerados').update(rej
        ? { status: 'rejeitado', motivo_rejeicao: r.dados.motivo }
        : { status: 'dispensado', motivo_dispensa: r.dados.motivo }).eq('id', d.id));
      if (!rej) await verificarConclusaoAcao(d.acao_id);
      aviso(rej ? 'Documento rejeitado.' : 'Documento dispensado.', 'ok');
    }
    rotear();
  } catch (e) { erro(e, 'Documento'); }
}

// ---------------------------------------------------------------------
// Nova ação: monta o kit, pede os dados e gera os documentos
// ---------------------------------------------------------------------
async function telaNovaAcao(colabId) {
  if (!podeEditar()) throw new Error('Sem permissão.');
  const c = await q(sb.from('colaboradores').select('*').eq('id', colabId).single());
  if (!c.funcao_id) throw new Error('Defina a função do colaborador antes de iniciar uma ação.');
  const kitTodo = await q(sb.from('funcao_documentos').select('*').eq('funcao_id', c.funcao_id));
  const { tipos, campo, modelo, funcao, empresa } = estado.cache;
  const tiposComKit = tipos.filter(t => t.ativo && kitTodo.some(k => k.tipo_acao === t.codigo));
  const sugerido = c.situacao === 'em_admissao' ? 'admissao' : '';

  app.innerHTML = `
    <div class="cabecalho"><div><h1>Nova ação</h1>
      <p class="sub">${esc(c.nome)} · ${esc(funcao[c.funcao_id]?.nome || '')}</p></div></div>
    <form id="f-acao">
      <div class="cartao">
        <div class="form-grade">
          <div class="campo"><label>Tipo de ação <span class="obrig">*</span></label>
            <select name="tipo" required><option value=""></option>
              ${tiposComKit.map(t => `<option value="${t.codigo}" ${t.codigo === sugerido ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}
            </select>
            ${tiposComKit.length ? '' : '<small>Nenhum kit configurado para esta função. Configure em Cadastros → Kits.</small>'}</div>
        </div>
      </div>
      <div id="etapa2"></div>
    </form>`;

  const form = $('#f-acao');
  let estadoForm = {};
  const lerForm = () => {
    const f = new FormData(form); const o = {};
    for (const [k, v] of f.entries()) if (k.startsWith('acao.')) o[k.slice(5)] = String(v).trim();
    return o;
  };

  const desenhar = () => {
    const tipoSel = form.tipo.value;
    if (!tipoSel) { $('#etapa2').innerHTML = ''; return; }
    estadoForm = { ...estadoForm, ...lerForm() };
    const itens = kitTodo.filter(k => k.tipo_acao === tipoSel);
    const kit = resolverKit(itens, estadoForm);
    const condicoes = [...new Set(itens.map(k => k.condicao_campo).filter(Boolean))];
    // marcadores acao.* usados pelos documentos do kit + campos de condição
    const marcadores = new Set(['acao.data_documento', ...condicoes]);
    const marcColab = new Set();
    for (const k of kit) for (const t of modelo[k.modelo_id]?.ativa?.marcadores || []) {
      if (t.startsWith('acao.')) marcadores.add(t);
      if (t.startsWith('colaborador.')) marcColab.add(t.split('.')[1]);
    }
    const camposAcao = [...marcadores].map(k => campo[k] || { chave: k, rotulo: k, tipo: 'texto' })
      .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
    if (!estadoForm.data_documento) estadoForm.data_documento = hojeISO();

    // dados do colaborador que faltam e vão aparecer em branco
    const dadosColab = montarDados({ colaborador: c }).colaborador;
    const faltando = [...marcColab].filter(n => n !== 'endereco_completo' && (dadosColab[n] === null || dadosColab[n] === undefined || dadosColab[n] === ''))
      .map(n => campo['colaborador.' + n]?.rotulo || n);
    if (marcColab.has('endereco_completo') && !c.endereco) faltando.push('Endereço');
    const semModelo = kit.filter(k => !modelo[k.modelo_id]?.ativa);

    $('#etapa2').innerHTML = `
      <div class="cartao"><h2>Dados desta ação</h2>
        <div class="form-grade">${camposAcao.map(x => inputCampo({ ...x, obrigatorio: x.obrigatorio || condicoes.includes(x.chave) },
          estadoForm[x.chave.split('.')[1]])).join('')}</div>
      </div>
      <div class="cartao"><h2>Documentos que serão gerados (${kit.length - semModelo.length})</h2>
        ${faltando.length ? `<div class="alerta-caixa atencao">Dados do colaborador em branco que aparecem nos documentos:
          <b>${faltando.map(esc).join(', ')}</b>. Eles sairão como "__________".
          <a href="#/colaborador-editar/${c.id}">Completar cadastro</a></div>` : ''}
        ${semModelo.length ? `<div class="alerta-caixa atencao">Sem modelo carregado (não serão gerados):
          <ul>${semModelo.map(k => `<li>${esc(modelo[k.modelo_id]?.nome)}</li>`).join('')}</ul></div>` : ''}
        <ul class="kit-lista">${kit.filter(k => modelo[k.modelo_id]?.ativa).map(k => `<li>
          <span>${esc(modelo[k.modelo_id].nome)}</span>
          <span>${k.obrigatorio ? '' : '<span class="etq etq-cinza">opcional</span> '}${modelo[k.modelo_id].exige_assinatura ? '<span class="etq etq-amarelo">assinatura</span>' : '<span class="etq etq-cinza">só entrega</span>'}</span>
        </li>`).join('')}</ul>
        <div class="rodape-form">
          <a class="btn" href="#/colaborador/${c.id}">Cancelar</a>
          <button class="btn btn-destaque" ${kit.length - semModelo.length ? '' : 'disabled'}>Gerar documentos</button>
        </div>
      </div>`;
    condicoes.forEach(cc => { const el = form.elements[cc]; if (el) el.onchange = desenhar; });
  };
  form.tipo.onchange = () => { estadoForm = {}; desenhar(); };
  desenhar();

  form.onsubmit = async ev => {
    ev.preventDefault();
    const btn = form.querySelector('.btn-destaque'); btn.disabled = true; btn.textContent = 'Gerando…';
    try {
      const dadosAcao = lerForm();
      for (const k of Object.keys(dadosAcao)) if (dadosAcao[k] === '') delete dadosAcao[k];
      const kit = resolverKit(kitTodo.filter(k => k.tipo_acao === form.tipo.value), dadosAcao)
        .filter(k => modelo[k.modelo_id]?.ativa);
      const acaoId = await gerarAcao({ colab: c, tipoAcao: form.tipo.value, dadosAcao, kit, empresa: empresa[c.empresa_id], funcao: funcao[c.funcao_id] });
      aviso('Documentos gerados.', 'ok');
      location.hash = '#/colaborador/' + c.id;
      const docs = await q(sb.from('documentos_gerados').select('*').eq('acao_id', acaoId));
      baixarZip({ tipo_acao: form.tipo.value }, docs, c);
    } catch (e) {
      erro(e, 'Gerar documentos');
      btn.disabled = false; btn.textContent = 'Gerar documentos';
    }
  };
}

async function gerarAcao({ colab, tipoAcao, dadosAcao, kit, empresa, funcao }) {
  const acao = await q(sb.from('acoes').insert({
    colaborador_id: colab.id, tipo_acao: tipoAcao, funcao_id: colab.funcao_id,
    data_acao: dadosAcao.data_documento || hojeISO(), dados: dadosAcao, status: 'rascunho',
  }).select('*').single(), 'Criar ação');

  const dados = montarDados({ colaborador: colab, empresa, funcao, acao });
  const { modelo } = estado.cache;
  for (const k of kit) {
    const m = modelo[k.modelo_id];
    const versao = m.ativa;
    const modeloBlob = await baixarStorage(versao.arquivo_path);
    const gerado = motor.gerar(await modeloBlob.arrayBuffer(), dados);
    const docId = crypto.randomUUID();
    const path = `colaboradores/${colab.id}/${acao.id}/${docId}_gerado.docx`;
    const { error } = await sb.storage.from(BUCKET).upload(path, gerado, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    if (error) throw new Error(`Envio de "${m.nome}": ${error.message}`);
    let validade = null;
    if (m.validade_meses) {
      const d = new Date(dados.acao.data_documento + 'T12:00:00');
      d.setMonth(d.getMonth() + m.validade_meses);
      validade = d.toISOString().slice(0, 10);
    }
    await q(sb.from('documentos_gerados').insert({
      id: docId, acao_id: acao.id, colaborador_id: colab.id, modelo_id: m.id, versao_id: versao.id,
      obrigatorio: k.obrigatorio, arquivo_gerado_path: path, validade_ate: validade,
      status: m.exige_assinatura ? 'aguardando_assinatura' : 'dispensado',
      motivo_dispensa: m.exige_assinatura ? null : 'Não exige assinatura própria (entrega registrada no recibo).',
    }), `Registrar "${m.nome}"`);
  }
  await q(sb.from('acoes').update({ status: 'gerada', snapshot: dados }).eq('id', acao.id), 'Finalizar ação');
  return acao.id;
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
    <div class="cabecalho"><div><h1>Cadastros</h1><p class="sub">Configuração dos documentos, kits e acessos.</p></div></div>
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
    <div class="cabecalho">
      <p class="sub" style="margin:0">${modelos.length} documento(s)-base · ${sem} sem modelo carregado</p>
      <div class="acoes">
        <button class="btn" id="importar">Importar modelos padrão</button>
        <button class="btn btn-destaque" id="novo-modelo">+ Novo documento-base</button>
      </div>
    </div>
    <div class="cartao" style="padding:0"><div class="tabela-wrap"><table>
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
    <div class="alerta-caixa info">Nos arquivos .docx, use marcadores como <span class="mono">{colaborador.nome}</span>,
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
    const { error } = await sb.storage.from(BUCKET).upload(path, new Blob([conteudo]), {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: true,
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
    <div class="cartao" style="padding:0"><div class="tabela-wrap"><table>
      <thead><tr><th>Ordem</th><th>Documento</th><th>Obrigatório</th><th>Condição</th><th>Modelo</th><th></th></tr></thead>
      <tbody>${itens.length ? itens.map(i => `<tr>
        <td>${i.ordem}</td><td><b>${esc(modelo[i.modelo_id]?.nome)}</b></td>
        <td>${i.obrigatorio ? 'Sim' : 'Não'}</td>
        <td>${i.condicao_campo ? `<span class="mono">${esc(i.condicao_campo)} = ${esc(i.condicao_valor)}</span>` : '<span class="muted">sempre</span>'}</td>
        <td>${modelo[i.modelo_id]?.ativa ? '<span class="etq etq-verde">ok</span>' : '<span class="etq etq-amarelo">sem modelo</span>'}</td>
        <td class="direita"><button class="btn btn-pequeno btn-perigo" data-remover="${i.modelo_id}">Remover</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="vazio">Nenhum documento neste kit.</td></tr>'}</tbody></table></div></div>
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
    <div class="cartao" style="padding:0"><div class="tabela-wrap"><table>
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
    <div class="alerta-caixa info">Formatações disponíveis nos modelos: <span class="mono">|data</span>, <span class="mono">|data_extenso</span>,
      <span class="mono">|dia</span>, <span class="mono">|mes_extenso</span>, <span class="mono">|ano</span>, <span class="mono">|moeda</span>,
      <span class="mono">|extenso</span>, <span class="mono">|maiusculas</span>. Ex.: <span class="mono">{colaborador.salario|extenso}</span></div>
    ${Object.entries(grupos).map(([g, t]) => `<div class="cartao" style="padding:0">
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
    <div class="cartao" style="padding:0"><div class="tabela-wrap"><table>
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
