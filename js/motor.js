// =====================================================================
// Motor de geração de documentos (funciona no navegador e no Node).
// Recebe as bibliotecas por injeção: { Docxtemplater, PizZip, expressions }.
// =====================================================================

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const VAZIO = '__________';

function partesData(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { a: +m[1], m: +m[2], d: +m[3] };
}

// ---------- número por extenso (pt-BR) ----------
const UN = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CT = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100, partes = [];
  if (c) partes.push(CT[c]);
  if (r) {
    if (r < 20) partes.push(UN[r]);
    else partes.push(DZ[Math.floor(r / 10)] + (r % 10 ? ' e ' + UN[r % 10] : ''));
  }
  return partes.join(' e ');
}

function inteiroPorExtenso(n) {
  if (n === 0) return 'zero';
  const grupos = [];
  let x = n;
  while (x > 0) { grupos.push(x % 1000); x = Math.floor(x / 1000); }
  const nomes = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let t = (i === 1 && g === 1) ? '' : ate999(g);
    const nome = i ? (g === 1 ? nomes[i][0] : nomes[i][1]) : '';
    partes.push({ txt: [t, nome].filter(Boolean).join(' '), g, i });
  }
  // conector "e": antes do último grupo quando ele é < 100 ou centena redonda
  return partes.map((p, k) => {
    if (k === 0) return p.txt;
    const usaE = p.i === 0 && (p.g < 100 || p.g % 100 === 0);
    return (usaE ? ' e ' : ' ') + p.txt;
  }).join('');
}

export function valorPorExtenso(valor) {
  const v = Math.round(Number(valor) * 100);
  if (!isFinite(v)) return VAZIO;
  const reais = Math.floor(v / 100), cent = v % 100;
  const partes = [];
  if (reais) {
    const milhaoRedondo = reais >= 1000000 && reais % 1000000 === 0;
    partes.push(inteiroPorExtenso(reais) + (milhaoRedondo ? ' de' : '') + (reais === 1 ? ' real' : ' reais'));
  }
  if (cent) partes.push(inteiroPorExtenso(cent) + (cent === 1 ? ' centavo' : ' centavos'));
  return partes.length ? partes.join(' e ') : 'zero real';
}

// ---------- filtros disponíveis nos modelos ----------
export const FILTROS = {
  data: v => { const p = partesData(v); return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.a}` : VAZIO; },
  data_extenso: v => { const p = partesData(v); return p ? `${p.d === 1 ? '1º' : p.d} de ${MESES[p.m - 1]} de ${p.a}` : VAZIO; },
  dia: v => { const p = partesData(v); return p ? String(p.d).padStart(2, '0') : '____'; },
  mes_extenso: v => { const p = partesData(v); return p ? MESES[p.m - 1] : '______________'; },
  ano: v => { const p = partesData(v); return p ? String(p.a) : '______'; },
  moeda: v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? VAZIO
    : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  extenso: v => (v === null || v === undefined || v === '') ? VAZIO : valorPorExtenso(v),
  maiusculas: v => (v === null || v === undefined || v === '') ? VAZIO : String(v).toLocaleUpperCase('pt-BR'),
};

// ---------- montagem dos dados ----------
function juntar(...partes) { return partes.filter(x => x !== null && x !== undefined && String(x).trim() !== '').join(', '); }

export function enderecoCompleto(o) {
  if (!o) return '';
  const rua = [o.endereco, o.numero].filter(Boolean).join(', ') + (o.complemento ? ' - ' + o.complemento : '');
  const cidade = [o.cidade, o.uf].filter(Boolean).join('/');
  return juntar(rua, o.bairro, cidade, o.cep ? 'CEP ' + o.cep : '');
}

export function montarDados({ colaborador = {}, empresa = {}, funcao = {}, acao = {} }) {
  const { dados_extras, ...colab } = colaborador;
  const acaoDados = { ...(acao.dados || {}) };
  if (!acaoDados.data_documento) acaoDados.data_documento = new Date().toISOString().slice(0, 10);
  if (!acaoDados.data_vigencia) acaoDados.data_vigencia = colaborador.data_admissao || acaoDados.data_documento;
  return {
    colaborador: { ...colab, ...(dados_extras || {}), endereco_completo: enderecoCompleto(colaborador) },
    empresa: { ...empresa, endereco_completo: enderecoCompleto(empresa) },
    funcao: { ...funcao },
    acao: acaoDados,
  };
}

// ---------- kit: quais documentos entram nesta ação ----------
export function resolverKit(itensKit, dadosAcao = {}) {
  return itensKit
    .filter(i => {
      if (!i.condicao_campo) return true;
      const chave = i.condicao_campo.replace(/^acao\./, '');
      return String(dadosAcao[chave] ?? '') === String(i.condicao_valor);
    })
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

// ---------- leitura dos marcadores de um .docx ----------
export function criarMotor({ Docxtemplater, PizZip, expressions }) {
  for (const [nome, fn] of Object.entries(FILTROS)) expressions.filters[nome] = fn;

  function parser(tag) {
    const expr = expressions.compile(tag.replace(/[’‘]/g, "'"));
    return {
      get(escopo) {
        const v = expr(escopo);
        return (v === null || v === undefined || v === '') ? VAZIO : v;
      },
    };
  }

  function listarMarcadores(conteudo) {
    const zip = new PizZip(conteudo);
    const textos = Object.keys(zip.files)
      .filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
      .map(n => zip.file(n).asText().replace(/<[^>]+>/g, ''));
    const encontrados = new Set();
    for (const t of textos) {
      for (const m of t.matchAll(/\{\s*([a-z_]+\.[a-z0-9_]+)\s*(?:\|[^}]*)?\}/g)) encontrados.add(m[1]);
    }
    return [...encontrados].sort();
  }

  function gerar(conteudo, dados) {
    const zip = new PizZip(conteudo);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, parser });
    doc.render(dados);
    return doc.getZip().generate({
      type: typeof window === 'undefined' ? 'nodebuffer' : 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE',
    });
  }

  return { listarMarcadores, gerar };
}
