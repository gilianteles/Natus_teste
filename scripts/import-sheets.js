/* Importa o histórico da planilha antiga do Natus (Google Sheets exportada como .xlsx) para o PostgreSQL.
 *   1) No Google Sheets: Arquivo > Fazer download > Microsoft Excel (.xlsx)
 *   2) DATABASE_URL=... node scripts/import-sheets.js caminho/para/planilha.xlsx [--limpar]
 * Abas lidas (pelo nome dos cabeçalhos): Setores, Leitos, Pacientes, Internacoes, Movimentacoes, Usuarios,
 * Contato_Pele_Pele, Indicadores_Leito. As senhas legadas (sha256$...) continuam válidas e são migradas no 1º login. */
require('../lib/tz');
const XLSX = require('xlsx');
const { getPool } = require('../lib/db');

const arq = process.argv[2];
if (!arq) { console.error('Uso: node scripts/import-sheets.js planilha.xlsx [--limpar]'); process.exit(1); }
const S = v => (v === null || v === undefined ? '' : String(v).trim());
const pad = n => String(n).padStart(2, '0');

// serial do Excel -> componentes de relógio (sem fuso)
function serial(v) {
  const dias = Math.floor(v), seg = Math.round((v - dias) * 86400);
  const base = new Date(Date.UTC(1899, 11, 30) + dias * 86400000);
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate(), H: Math.floor(seg / 3600) % 24, M: Math.floor(seg / 60) % 60, s: seg % 60 };
}
function partes(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate(), H: v.getHours(), M: v.getMinutes(), s: 0 };
  if (typeof v === 'number') return serial(v);
  const t = S(v);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3], H: +(m[4] || 0), M: +(m[5] || 0), s: +(m[6] || 0) };
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return { y: +m[3], m: +m[2], d: +m[1], H: +(m[4] || 0), M: +(m[5] || 0), s: +(m[6] || 0) };
  return null;
}
const ts = v => { const p = partes(v); return p ? `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.H)}:${pad(p.M)}:${pad(p.s)}` : null; };
const dt = v => { const p = partes(v); return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null; };
const hora = v => { if (typeof v === 'number') { const p = serial(v); return `${pad(p.H)}:${pad(p.M)}`; } if (v instanceof Date) return `${pad(v.getHours())}:${pad(v.getMinutes())}`; return S(v); };
const num = v => { const t = S(v); return t !== '' && !isNaN(Number(t)) ? Number(t) : null; };

const wb = XLSX.readFile(arq, { cellDates: false, raw: true });
const aba = nome => { const n = wb.SheetNames.find(x => x.trim().toLowerCase() === nome.toLowerCase()); return n ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: true }) : []; };

(async () => {
  const pool = getPool(), c = await pool.connect(), rel = {};
  try {
    await c.query('BEGIN');
    if (process.argv.includes('--limpar')) await c.query('TRUNCATE movimentacoes, contato_pele_pele, indicadores_leito, internacoes, pacientes, leitos, setores, usuarios, sessoes RESTART IDENTITY CASCADE');
    const setoresSet = new Set((await c.query('SELECT nome_setor FROM setores')).rows.map(r => r.nome_setor.toUpperCase()));
    const garantirSetor = async nome => { const n = S(nome); if (!n || setoresSet.has(n.toUpperCase())) return; setoresSet.add(n.toUpperCase());
      await c.query(`INSERT INTO setores (id_setor,nome_setor,tipo,capacidade_inicial) VALUES ($1,$2,'Internação',0) ON CONFLICT DO NOTHING`, [n.toUpperCase().replace(/\s+/g, '_'), n]); };
    const cont = (k, n = 1) => (rel[k] = (rel[k] || 0) + n);

    for (const s of aba('Setores')) {
      const nome = S(s.Nome_Setor); if (!nome) continue; setoresSet.add(nome.toUpperCase());
      await c.query(`INSERT INTO setores (id_setor,nome_setor,tipo,capacidade_inicial) VALUES ($1,$2,$3,$4) ON CONFLICT (nome_setor) DO NOTHING`,
        [S(s.ID_Setor) || nome.toUpperCase().replace(/\s+/g, '_'), nome, S(s.Tipo) || 'Internação', Math.max(0, num(s.Leitos_Ativos ?? s.Capacidade ?? s.Leitos) || 0)]); cont('setores');
    }
    const leitoNum = new Map();
    for (const l of aba('Leitos')) {
      const id = S(l.ID_Leito); if (!id) continue; await garantirSetor(l.ID_Setor);
      const st = S(l.Status) === 'Reserva' ? 'Reservado' : (['Livre', 'Ocupado', 'Reservado', 'Bloqueado'].includes(S(l.Status)) ? S(l.Status) : 'Livre');
      leitoNum.set(id, S(l.Numero_Leito));
      await c.query(`INSERT INTO leitos (id_leito,setor_nome,numero_leito,status,id_paciente_atual,exame_externo,id_paciente_mae,id_paciente_rn) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id_leito) DO NOTHING`,
        [id, S(l.ID_Setor), S(l.Numero_Leito), st, S(l.ID_Paciente_Atual) || null, S(l.Exame_Externo) === 'Sim' ? 'Sim' : 'Não', S(l.ID_Paciente_Mae) || null, S(l.ID_Paciente_RN) || null]); cont('leitos');
    }
    const pacs = new Set();
    for (const p of aba('Pacientes')) {
      const id = S(p.ID_Paciente); if (!id) continue; pacs.add(id);
      await c.query(`INSERT INTO pacientes (id_paciente,nome,data_nascimento,sexo,numero_prontuario) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id_paciente) DO NOTHING`,
        [id, S(p.Nome) || '(sem nome)', dt(p.Data_Nascimento), S(p.Sexo).substring(0, 1) || null, S(p.Numero_Prontuario)]); cont('pacientes');
    }
    const ints = new Set();
    for (const i of aba('Internacoes')) {
      const id = S(i.ID_Internacao), entrada = ts(i.Data_Hora_Entrada);
      if (!id || !entrada || !S(i.ID_Setor)) { cont('internacoes_ignoradas'); continue; }
      await garantirSetor(i.ID_Setor);
      if (!pacs.has(S(i.ID_Paciente))) { pacs.add(S(i.ID_Paciente)); await c.query(`INSERT INTO pacientes (id_paciente,nome) VALUES ($1,'(paciente não encontrado)') ON CONFLICT DO NOTHING`, [S(i.ID_Paciente)]); cont('pacientes_placeholder'); }
      ints.add(id);
      await c.query(`INSERT INTO internacoes (id_internacao,id_paciente,id_leito,numero_leito,setor_nome,data_hora_entrada,procedencia,tipo_parto,peso_nascer,status,hora_nascimento,ig,gravidade,tipo_paciente,observacao_procedimento,rn_sozinho)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id_internacao) DO NOTHING`,
        [id, S(i.ID_Paciente), S(i.ID_Leito) || null, leitoNum.get(S(i.ID_Leito)) || '', S(i.ID_Setor), entrada, S(i.Procedencia), S(i.Tipo_Parto), S(i.Peso_Nascer),
         S(i.Status) || 'Ativo', hora(i.Hora_Nascimento), S(i.IG), S(i.Gravidade), S(i.Tipo_Paciente), S(i.Observacao_Procedimento), S(i.RN_Sozinho)]); cont('internacoes');
    }
    for (const m of aba('Movimentacoes')) {
      const id = S(m.ID_Movimentacao || m.ID_Movimento), saida = ts(m.Data_Hora_Saida), tipo = S(m.Tipo_Movimento);
      if (!id || !saida || !ints.has(S(m.ID_Internacao)) || !['Alta', 'Obito', 'Evasao', 'Transferencia'].includes(tipo)) { cont('movimentacoes_ignoradas'); continue; }
      await c.query(`INSERT INTO movimentacoes (id_movimentacao,id_internacao,tipo_movimento,data_hora_saida,destino,observacao,peso_saida_gramas,aleitamento_exclusivo_alta,etapa_metodo_canguru)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id_movimentacao) DO NOTHING`,
        [id, S(m.ID_Internacao), tipo, saida, S(m.Destino), S(m.Observacao), num(m.Peso_Saida_Gramas), S(m.Aleitamento_Exclusivo_Alta), S(m.Etapa_Metodo_Canguru)]); cont('movimentacoes');
    }
    for (const u of aba('Usuarios')) {
      if (!S(u.Nome) || !S(u.Senha)) continue;
      await c.query(`INSERT INTO usuarios (nome,perfil,setor,senha_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (lower(nome)) DO NOTHING`, [S(u.Nome), S(u.Perfil), S(u.Setor), S(u.Senha)]); cont('usuarios');
    }
    for (const r of aba('Contato_Pele_Pele')) {
      if (!ints.has(S(r.ID_Internacao)) || !dt(r.Data_Contato)) { cont('pele_ignorados'); continue; }
      await c.query(`INSERT INTO contato_pele_pele (id_pele_pele,id_internacao,id_paciente,id_leito,setor_nome,data_contato,contato_realizado,duracao_min,dia_vida,registrado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [S(r.ID_Pele_Pele) || 'PP-' + S(r.ID_Internacao) + '-' + dt(r.Data_Contato), S(r.ID_Internacao), S(r.ID_Paciente), S(r.ID_Leito) || null, S(r.ID_Setor), dt(r.Data_Contato),
         S(r.Contato_Realizado) === 'Sim' ? 'Sim' : 'Não', Math.round(num(r.Duracao_Min) || 0), S(r.Dia_Vida), S(r.Registrado_Por)]); cont('pele_a_pele');
    }
    for (const r of aba('Indicadores_Leito')) {
      if (!ints.has(S(r.ID_Internacao)) || !dt(r.Data)) { cont('indicadores_ignorados'); continue; }
      const sn = v => (S(v) === 'Sim' ? 'Sim' : 'Não');
      await c.query(`INSERT INTO indicadores_leito (id_indicador,id_internacao,id_paciente,id_leito,setor_nome,data,extracao_leite_beira_leito,visita_mae,visita_pai,visita_irmao,visita_avos,registrado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
        [S(r.ID_Indicador) || 'IND-' + S(r.ID_Internacao) + '-' + dt(r.Data), S(r.ID_Internacao), S(r.ID_Paciente), S(r.ID_Leito) || null, S(r.ID_Setor), dt(r.Data),
         sn(r.Extracao_Leite_Beira_Leito), sn(r.Visita_Mae), sn(r.Visita_Pai), sn(r.Visita_Irmao), sn(r.Visita_Avos), S(r.Registrado_Por)]); cont('indicadores');
    }
    await c.query('COMMIT');
    console.log('Importação concluída:', rel);
  } catch (e) { await c.query('ROLLBACK'); console.error('Importação revertida:', e.message); process.exitCode = 1; }
  finally { c.release(); await pool.end(); }
})();
