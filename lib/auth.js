const crypto = require('crypto');
const {hashToken} = require('./http-security');
const { query, transacao } = require('./db');
const { registrarLog } = require('./log');
const R = require('./regras');
const U = require('./util');
const S = v => String(v == null ? '' : v).trim();
const digitos = v => U.somenteDigitos(v);

const SESSAO_HORAS = Number(process.env.SESSION_HOURS || 12);
const SENHA_MIN = 6;

/* ---------- senhas: scrypt com sal; aceita (e migra) o sha256 legado da planilha ---------- */
function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha), sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}
function sha256Legado(senha) { return 'sha256$' + crypto.createHash('sha256').update(String(senha == null ? '' : senha), 'utf8').digest('hex'); }
function conferirSenha(senha, armazenado) {
  const a = S(armazenado);
  if (a.startsWith('scrypt$')) {
    const [, salHex, hHex] = a.split('$');
    const h = crypto.scryptSync(String(senha), Buffer.from(salHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    const esperado = Buffer.from(hHex, 'hex');
    return esperado.length === h.length && crypto.timingSafeEqual(h, esperado);
  }
  if (/^sha256\$[a-f0-9]{64}$/i.test(a)) {
    const x = Buffer.from(sha256Legado(senha).toLowerCase()), y = Buffer.from(a.toLowerCase());
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
  return false;
}

/* ---------- validação de documentos ---------- */
function validarCPF(valor) {
  const cpf = digitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (fat) => { let t = 0; for (let i = 0; i < fat - 1; i++) t += Number(cpf[i]) * (fat - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
  return calc(10) === Number(cpf[9]) && calc(11) === Number(cpf[10]);
}
const validarEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S(e));
// Cartão SUS (CNS) possui 15 dígitos; aceitamos de 11 a 20 para não travar cadastros legados.
const validarCartaoSUS = v => { const d = digitos(v); return d.length >= 11 && d.length <= 20; };

/* ---------- login / sessão ---------- */
async function autenticar(ctx, nome, senha) {
  const login = S(nome);
  if (!login || !senha) throw new Error('Nome ou senha inválidos.');
  // limite de tentativas: 8 falhas em 15 min para o mesmo login
  const falhas = (await query(`SELECT count(*)::int n FROM logs WHERE acao='LOGIN_FALHA' AND lower(usuario)=lower($1) AND data_hora > now() - interval '15 minutes'`, [login])).rows[0].n;
  if (falhas >= 8) throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');

  // Aceita o login pelo usuário ou pelo e-mail profissional.
  const { rows } = await query(
    `SELECT nome, perfil, setor, senha_hash, administrador, status FROM usuarios
      WHERE lower(nome)=lower($1) OR (email <> '' AND lower(email)=lower($1))`, [login]);
  const user = rows[0];
  if (!user || !conferirSenha(senha, user.senha_hash)) {
    await registrarLog(null, login, 'LOGIN_FALHA', 'Tentativa de login inválida.');
    throw new Error('Nome ou senha inválidos.');
  }
  if (S(user.status) === 'Inativo') {
    await registrarLog(null, user.nome, 'LOGIN_BLOQUEADO', 'Tentativa de login de usuário inativo.');
    throw new Error('Usuário inativo. Procure o administrador do sistema.');
  }
  const token = crypto.randomBytes(32).toString('hex');
  await transacao(async c => {
    const atual = (await c.query('SELECT * FROM usuarios WHERE lower(nome)=lower($1) FOR UPDATE', [user.nome])).rows[0];
    if (!atual || atual.senha_hash !== user.senha_hash || S(atual.status).toUpperCase() === 'INATIVO') throw new Error('Cadastro alterado. Faça login novamente.');
    if (!user.senha_hash.startsWith('scrypt$')) await c.query('UPDATE usuarios SET senha_hash=$2 WHERE lower(nome)=lower($1)', [user.nome, hashSenha(senha)]);
    Object.assign(user, atual);
    await c.query(`INSERT INTO sessoes (token, nome, perfil, setor, administrador, expira_em) VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' hours')::interval)`,
      [hashToken(token), user.nome, user.perfil, user.setor || '', !!user.administrador, String(SESSAO_HORAS)]);
  });
  query('DELETE FROM sessoes WHERE expira_em < now()').catch(() => {});
  await registrarLog(null, user.nome, 'LOGIN', 'Usuário realizou login no sistema.');
  return { token, nome: user.nome, perfil: user.perfil, setor: user.setor || '', administrador: !!user.administrador };
}

async function validarSessao(token) {
  if (!token) return null;
  const { rows } = await query(`SELECT s.nome, s.perfil, s.setor, s.administrador, s.expira_em,
      u.perfil AS u_perfil, u.setor AS u_setor, u.administrador AS u_adm, u.status AS u_status
    FROM sessoes s LEFT JOIN usuarios u ON lower(u.nome) = lower(s.nome)
    WHERE s.token=$1 AND s.expira_em > now()`, [hashToken(token)]);
  const r = rows[0];
  if (!r) return null;
  // Segurança: as permissões da sessão são revalidadas a cada requisição contra o cadastro atual.
  // Se o usuário foi removido ou inativado, a sessão deixa de valer imediatamente (revogação).
  if (r.u_perfil == null) {
    await query('DELETE FROM sessoes WHERE token=$1', [hashToken(token)]).catch(() => {});
    return null;
  }
  if (S(r.u_status).toUpperCase() === 'INATIVO') {
    await query('DELETE FROM sessoes WHERE token=$1', [hashToken(token)]).catch(() => {});
    return null;
  }
  return {
    nome: r.nome,
    perfil: S(r.u_perfil),
    setor: r.u_setor != null ? (r.u_setor || '') : (r.setor || ''),
    administrador: !!r.u_adm
  };
}

async function encerrarSessao(ctx, token) {
  const { rows } = await query('DELETE FROM sessoes WHERE token=$1 RETURNING nome', [hashToken(token || '')]);
  if (rows[0]) await registrarLog(null, rows[0].nome, 'LOGOUT', 'Sessão encerrada.');
  return { success: true };
}

/* ---------- autorização ---------- */
function exigirAdministrativo(ctx) {
  if (!ctx.sessao || !R.ehPerfilAdministrativo(ctx.sessao.perfil)) throw new Error('Acesso restrito aos perfis NIR/SAME.');
}
// FASE 3: somente Administrador (perfil dedicado ou marca no usuário) gerencia cadastro de usuários.
function ehAdministrador(sessao) {
  return !!(sessao && (sessao.administrador === true || R.ehPerfilAdministrador(sessao.perfil)));
}
function exigirAdministrador(ctx) {
  if (!ehAdministrador(ctx.sessao)) throw new Error('Acesso restrito: apenas o perfil Administrador pode cadastrar ou gerenciar usuários.');
}
function podeAcessarSetor(sessao, setor) {
  if (!sessao) return false;
  if (R.ehPerfilNIR(sessao.perfil)) return true;
  return U.igual(sessao.setor, setor);
}
function exigirSetor(ctx, setor) {
  if (!podeAcessarSetor(ctx.sessao, setor)) throw new Error('Você não tem acesso a este setor.');
}
// O ACR é a recepção do acolhimento: disponível a qualquer colaborador autenticado (o cadastro
// fica auditado nos logs). Se a instituição quiser restringir, troque o retorno por uma
// verificação de perfil/setor.
function exigirACR(ctx) {
  if (!ctx.sessao) throw new Error('Sessão inválida ou expirada. Faça login novamente.');
}

/* ---------- gestão de usuários (somente Administrador escreve) ---------- */
const PERFIL_ACESSO_NORMALIZADO = { ADMIN: 'Administrador', ADMINISTRADOR: 'Administrador', ADMINISTRATIVE: 'Administrador' };
function normalizarPerfil(perfil) {
  const p = S(perfil);
  if (PERFIL_ACESSO_NORMALIZADO[U.upper(p)]) return PERFIL_ACESSO_NORMALIZADO[U.upper(p)];
  const encontrado = R.PERFIS_ACESSO.find(x => U.igual(x, p));
  return encontrado || p;
}

async function obterUsuariosAdministrativos(ctx) {
  exigirAdministrativo(ctx);
  const { rows } = await query(`SELECT nome, perfil, setor, nome_completo, cpf, email, telefone, cargo, status, administrador
    FROM usuarios ORDER BY coalesce(nullif(nome_completo,''), nome)`);
  return rows.map(u => ({
    nome: S(u.nome), perfil: S(u.perfil), setor: S(u.setor), nomeCompleto: S(u.nome_completo),
    cpf: S(u.cpf), email: S(u.email), telefone: S(u.telefone), cargo: S(u.cargo),
    status: S(u.status) || 'Ativo', administrador: !!u.administrador
  }));
}
async function obterSetoresParaUsuario(ctx) {
  exigirAdministrativo(ctx);
  return (await query('SELECT nome_setor FROM setores ORDER BY nome_setor')).rows.map(r => r.nome_setor);
}
// Metadados para montar o formulário de cadastro (perfis, cargos, status).
async function obterOpcoesUsuario(ctx) {
  exigirAdministrativo(ctx);
  return { perfis: R.PERFIS_ACESSO, cargos: R.CARGOS_SUGERIDOS, status: R.STATUS_USUARIO };
}

async function salvarUsuario(ctx, dados) {
  exigirAdministrador(ctx);                       // FASE 3: bloqueio estrito no servidor
  dados = dados || {};
  const nome = S(dados.nome || dados.login);
  const perfil = normalizarPerfil(dados.perfil);
  const setor = S(dados.setor);
  const senha = S(dados.senha);
  const nomeCompleto = S(dados.nomeCompleto);
  const cpf = digitos(dados.cpf);
  const email = S(dados.email).toLowerCase();
  const telefone = S(dados.telefone);
  const cargo = S(dados.cargo);
  const status = S(dados.status) || 'Ativo';

  if (!nome || !perfil) throw new Error('Preencha o Login e o Perfil de acesso.');
  if (!nomeCompleto) throw new Error('Informe o Nome Completo do colaborador.');
  if (!R.PERFIS_ACESSO.some(p => U.igual(p, perfil))) throw new Error('Perfil de acesso inválido.');
  if (!R.STATUS_USUARIO.some(s => U.igual(s, status))) throw new Error('Status do usuário inválido. Use Ativo ou Inativo.');
  if (!cpf || !validarCPF(cpf)) throw new Error('Informe um CPF válido (11 dígitos).');
  if (!email || !validarEmail(email)) throw new Error('Informe um e-mail profissional válido.');
  if (digitos(telefone).length < 10) throw new Error('Informe um telefone/WhatsApp com DDD.');
  if (!cargo) throw new Error('Informe o Cargo / Função do colaborador.');
  // Administrador atua de forma transversal: o setor é opcional. Os demais perfis exigem setor.
  if (!U.igual(perfil, 'Administrador') && !setor) throw new Error('Informe o Setor de atuação do colaborador.');

  const administrador = U.igual(perfil, 'Administrador');

  return transacao(async c => {
    const existente = (await c.query('SELECT nome, senha_hash, perfil, setor, administrador, status FROM usuarios WHERE lower(nome)=lower($1)', [nome])).rows[0];
    if (!existente && !senha) throw new Error('Informe a senha inicial do colaborador.');
    if (senha && senha.length < SENHA_MIN) throw new Error(`A senha deve ter ao menos ${SENHA_MIN} caracteres.`);

    // Conflitos de CPF/e-mail com outro usuário.
    const conflitoCpf = (await c.query(`SELECT nome FROM usuarios WHERE regexp_replace(cpf,'\\D','','g')=$1 AND lower(nome)<>lower($2)`, [cpf, nome])).rows[0];
    if (conflitoCpf) throw new Error(`O CPF informado já pertence ao usuário "${conflitoCpf.nome}".`);
    const conflitoEmail = email ? (await c.query(`SELECT nome FROM usuarios WHERE email <> '' AND lower(email)=lower($1) AND lower(nome)<>lower($2)`, [email, nome])).rows[0] : null;
    if (conflitoEmail) throw new Error(`O e-mail informado já pertence ao usuário "${conflitoEmail.nome}".`);

    const h = senha ? hashSenha(senha) : (existente ? existente.senha_hash : hashSenha(U.uuid()));
    const r = await c.query(`INSERT INTO usuarios (nome, perfil, setor, senha_hash, nome_completo, cpf, email, telefone, cargo, status, administrador, atualizado_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() AT TIME ZONE 'America/Manaus')
      ON CONFLICT (lower(nome)) DO UPDATE SET perfil=EXCLUDED.perfil, setor=EXCLUDED.setor, senha_hash=EXCLUDED.senha_hash,
        nome_completo=EXCLUDED.nome_completo, cpf=EXCLUDED.cpf, email=EXCLUDED.email, telefone=EXCLUDED.telefone,
        cargo=EXCLUDED.cargo, status=EXCLUDED.status, administrador=EXCLUDED.administrador, atualizado_em=EXCLUDED.atualizado_em
      RETURNING (xmax = 0) AS criado`, [nome, perfil, setor, h, nomeCompleto, cpf, email, telefone, cargo, status, administrador]);

    // Troca de senha, desativação ou mudança de perfil/setor/nível administrativo: derruba as
    // sessões ativas do usuário para que as novas permissões passem a valer imediatamente
    // (preserva a do próprio administrador logado).
    const mudouPermissoes = !!existente && (
      !U.igual(existente.perfil, perfil) || !U.igual(existente.setor, setor) ||
      (!!existente.administrador !== administrador) || !U.igual(existente.status, status));
    const derrubar = status === 'Inativo' || !!senha || mudouPermissoes;
    if (derrubar) await c.query('DELETE FROM sessoes WHERE lower(nome)=lower($1) AND lower(nome)<>lower($2)', [nome, ctx.sessao.nome]);
    await registrarLog(c, ctx.sessao.nome, r.rows[0].criado ? 'CRIAR_USUARIO' : 'EDITAR_USUARIO',
      `Usuário ${nome} (${nomeCompleto || '-'}) / Perfil ${perfil} / Cargo ${cargo || '-'} / Setor ${setor || '-'} / Status ${status}${administrador ? ' / ADMINISTRADOR' : ''}.`);
    return { success: true, criado: r.rows[0].criado };
  });
}
async function excluirUsuario(ctx, nome) {
  exigirAdministrador(ctx);                      // FASE 3
  const alvo = S(nome);
  if (!alvo) throw new Error('Usuário não informado.');
  if (U.igual(alvo, ctx.sessao.nome)) throw new Error('O usuário conectado não pode excluir a própria conta.');
  const alvoRow = (await query('SELECT administrador FROM usuarios WHERE lower(nome)=lower($1)', [alvo])).rows[0];
  if (!alvoRow) throw new Error('Usuário não encontrado.');
  if (alvoRow.administrador) {
    const total = (await query('SELECT count(*)::int n FROM usuarios WHERE administrador = true')).rows[0].n;
    if (total <= 1) throw new Error('Não é possível excluir o único Administrador do sistema.');
  }
  const r = await query('DELETE FROM usuarios WHERE lower(nome)=lower($1) RETURNING nome', [alvo]);
  if (!r.rowCount) throw new Error('Usuário não encontrado.');
  await query('DELETE FROM sessoes WHERE lower(nome)=lower($1)', [alvo]);
  await registrarLog(null, ctx.sessao.nome, 'EXCLUIR_USUARIO', `Usuário ${alvo} excluído.`);
  return { success: true };
}

module.exports = { hashSenha, conferirSenha, validarCPF, validarEmail, validarCartaoSUS, autenticar, validarSessao, encerrarSessao,
  SESSAO_HORAS,
  exigirAdministrativo, exigirAdministrador, ehAdministrador, exigirSetor, exigirACR, podeAcessarSetor,
  obterUsuariosAdministrativos, obterSetoresParaUsuario, obterOpcoesUsuario, salvarUsuario, excluirUsuario };
