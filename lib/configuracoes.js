// Configurações do sistema — personalização da BARRA LATERAL (quais módulos cada perfil enxerga).
//
// Importante (não-regressão): este controle é exclusivamente de EXIBIÇÃO (UX). A segurança de
// rotas permanece intacta em lib/auth.js (exigirSetor/exigirAdministrador), nos recortes por
// setor (lib/data.js) e nas guardas de tela (api/page.js). Nenhuma RPC de leitos, trocas,
// evolução SOAP ou relatórios muda de assinatura por causa desta personalização.
const { query } = require('./db');
const { registrarLog } = require('./log');
const R = require('./regras');
const U = require('./util');

const S = v => String(v == null ? '' : v).trim();
const CHAVES = R.CHAVES_MENU;

function ehAdministrador(sessao) {
  return !!(sessao && (sessao.administrador === true || R.ehPerfilAdministrador(sessao.perfil)));
}
function exigirAdministrador(ctx) {
  if (!ehAdministrador(ctx && ctx.sessao)) throw new Error('Acesso negado: apenas administradores podem alterar a visibilidade do menu.');
}
// Perfil canônico da lista oficial (tolera variação de caixa); null quando desconhecido.
function perfilCanonico(valor) {
  const p = S(valor);
  return R.PERFIS_ACESSO.find(x => U.igual(x, p)) || null;
}

// Mapa chave -> visível aplicado à navegação. Se a tabela ainda não existir (banco sem a
// migração), mantém o padrão do perfil para não quebrar o menu.
async function permissoesEfetivas(perfil) {
  const mapa = R.permissoesMenuPadrao(perfil);
  try {
    const { rows } = await query('SELECT modulo_chave, visivel FROM permissoes_menu WHERE lower(perfil) = lower($1)', [S(perfil)]);
    rows.forEach(r => { if (Object.prototype.hasOwnProperty.call(mapa, r.modulo_chave)) mapa[r.modulo_chave] = r.visivel === true; });
  } catch (e) { /* tabela ausente: usa o padrão do perfil */ }
  return mapa;
}

// Lista [{ modulo_chave, visivel }] com TODOS os módulos — usada no login e na aplicação
// dinâmica do menu no navegador (aplicarVisibilidadeMenu).
async function permissoesMenuDoPerfil(perfil) {
  const mapa = await permissoesEfetivas(perfil);
  return CHAVES.map(chave => ({ modulo_chave: chave, visivel: mapa[chave] !== false }));
}

// Leitura por RPC: cada usuário lê o próprio perfil; administradores podem consultar outros
// perfis (usado pela tela de Configurações e por integrações).
async function obterPermissoesMenu(ctx, perfil) {
  const alvo = S(perfil);
  const proprio = !alvo || U.igual(alvo, ctx.sessao.perfil) || !ehAdministrador(ctx.sessao);
  return permissoesMenuDoPerfil(proprio ? ctx.sessao.perfil : alvo);
}

// Matriz completa (perfis x módulos) para a tela de Configurações — exclusiva do Administrador.
// `elegiveis` informa quais células o perfil realmente pode exibir (as demais ficam fixas).
async function obterMatrizPermissoesMenu(ctx) {
  exigirAdministrador(ctx);
  const perfis = R.PERFIS_MENU.slice();
  const valores = {}, elegiveis = {};
  perfis.forEach(p => {
    const padrao = R.permissoesMenuPadrao(p);
    valores[p] = {}; elegiveis[p] = {};
    R.MODULOS_MENU.forEach(m => {
      valores[p][m.chave] = padrao[m.chave] !== false;
      elegiveis[p][m.chave] = R.moduloMenuElegivel(m.chave, p);
    });
  });
  const { rows } = await query('SELECT perfil, modulo_chave, visivel FROM permissoes_menu');
  rows.forEach(r => {
    const p = perfis.find(x => U.igual(x, r.perfil));
    if (p && Object.prototype.hasOwnProperty.call(valores[p], r.modulo_chave)) valores[p][r.modulo_chave] = r.visivel === true;
  });
  return { perfis, modulos: R.MODULOS_MENU, valores, elegiveis };
}

// Atualização (upsert) — exclusiva do Administrador. O perfil Administrador é imutável para
// evitar que a própria tela de Configurações desapareça do menu (perda de acesso).
async function atualizarPermissaoMenu(ctx, dados) {
  exigirAdministrador(ctx);
  dados = dados || {};
  const perfil = perfilCanonico(dados.perfil);
  if (!perfil) throw new Error('Perfil de acesso inválido.');
  if (U.igual(perfil, 'Administrador')) throw new Error('O menu do perfil Administrador é fixo e não pode ser alterado.');
  const chave = S(dados.modulo_chave);
  if (CHAVES.indexOf(chave) < 0) throw new Error('Módulo de menu inválido.');
  if (!R.moduloMenuElegivel(chave, perfil)) throw new Error('Este perfil não tem acesso ao módulo informado.');
  const visivel = dados.visivel === true || dados.visivel === 'true' || dados.visivel === 1;

  await query(
    `INSERT INTO permissoes_menu (perfil, modulo_chave, visivel, atualizado_em)
     VALUES ($1, $2, $3, (now() AT TIME ZONE 'America/Manaus'))
     ON CONFLICT (perfil, modulo_chave) DO UPDATE SET visivel = EXCLUDED.visivel, atualizado_em = EXCLUDED.atualizado_em`,
    [perfil, chave, visivel]);
  await registrarLog(null, ctx.sessao.nome, 'PERMISSAO_MENU', `Menu ${visivel ? 'exibido' : 'ocultado'} para o perfil ${perfil}: ${chave}.`);
  return { sucesso: true, perfil, modulo_chave: chave, visivel };
}

module.exports = { ehAdministrador, exigirAdministrador, permissoesEfetivas, permissoesMenuDoPerfil,
  obterPermissoesMenu, obterMatrizPermissoesMenu, atualizarPermissaoMenu };
