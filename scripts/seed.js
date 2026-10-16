// Cria os setores padrão, leitos iniciais (opcional) e o usuário administrador inicial.
//   ADMIN_NOME / ADMIN_SENHA  (obrigatória, mín. 8 caracteres)   SEED_LEITOS=10 (leitos por setor; 0 = nenhum)
require('../lib/tz');
const { getPool } = require('../lib/db');
const { hashSenha } = require('../lib/auth');
const { SETORES_PADRAO } = require('../lib/regras');
(async () => {
  const nome = process.env.ADMIN_NOME || 'admin', senha = process.env.ADMIN_SENHA || '';
  if (senha.length < 8) throw new Error('Defina ADMIN_SENHA com ao menos 8 caracteres.');
  const leitos = Number(process.env.SEED_LEITOS || 0);
  const p = getPool();
  const tipos = { 'UTI MATERNA': 'Obstétrico', 'ALCON 1': 'Alojamento Conjunto', 'ALCON 2': 'Alojamento Conjunto' };
  for (const s of [...SETORES_PADRAO, 'UEN']) {
    await p.query(`INSERT INTO setores (id_setor,nome_setor,tipo,capacidade_inicial) VALUES ($1,$2,$3,0) ON CONFLICT (nome_setor) DO NOTHING`,
      [s.replace(/\s+/g, '_'), s, s === 'UEN' ? 'Estabilização Neonatal (Vaga Zero)' : (tipos[s] || 'Neonatal')]);
    if (s !== 'UEN' && leitos > 0 && !(await p.query('SELECT 1 FROM leitos WHERE setor_nome=$1 LIMIT 1', [s])).rowCount)
      for (let n = 1; n <= leitos; n++) await p.query(`INSERT INTO leitos (id_leito,setor_nome,numero_leito) VALUES ($1,$2,$3)`, [`LEITO-${s.replace(/\s+/g, '_')}-${n}`, s, 'Leito ' + String(n).padStart(2, '0')]);
  }
  // FASE 3: o usuário semente nasce como Administrador (único perfil que cadastra usuários).
  await p.query(`INSERT INTO usuarios (nome,perfil,setor,senha_hash,nome_completo,cargo,status,administrador)
      VALUES ($1,'Administrador','NIR',$2,'Administrador do Sistema','Administrador','Ativo',true)
      ON CONFLICT (lower(nome)) DO NOTHING`, [nome, hashSenha(senha)]);
  console.log(`Seed concluído. Usuário administrador: ${nome} (perfil Administrador)`);
  await p.end();
})().catch(e => { console.error('Falha no seed:', e.message); process.exit(1); });
