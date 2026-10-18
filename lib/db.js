require('./tz');
const { Pool, types } = require('pg');

// timestamp (sem fuso) -> Date em horário de Manaus (TZ do processo); date -> 'YYYY-MM-DD'
types.setTypeParser(1114, v => { if (!v) return null; const m = v.match(/^(\d+)-(\d+)-(\d+)[ T](\d+):(\d+):(\d+)/); return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); });
types.setTypeParser(1082, v => v);
types.setTypeParser(1700, v => (v === null ? null : Number(v)));
types.setTypeParser(20, v => Number(v));

let pool;
function getPool() {
  if (!pool) {
    const cs = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!cs) throw new Error('DATABASE_URL não configurada.');
    const local = /localhost|127\.0\.0\.1/.test(cs);
    pool = new Pool({
      connectionString: cs,
      max: Number(process.env.PG_POOL_MAX || 3),
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      ssl: local || /sslmode=disable/.test(cs) ? false : { rejectUnauthorized: false }
    });
    pool.on('error', () => {});
  }
  return pool;
}

const query = (text, params) => getPool().query(text, params);

// Transação com trava global (substitui o LockService do Apps Script).
async function transacao(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('natus_escrita'))");
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally { client.release(); }
}

// Colunas SQL -> chaves "estilo planilha" usadas pelas regras de negócio e pelo front-end.
const COLS = {
  setores: { id_setor: 'ID_Setor', nome_setor: 'Nome_Setor', tipo: 'Tipo', capacidade_inicial: 'Leitos_Ativos' },
  leitos: { id_leito: 'ID_Leito', setor_nome: 'ID_Setor', numero_leito: 'Numero_Leito', status: 'Status', id_paciente_atual: 'ID_Paciente_Atual', exame_externo: 'Exame_Externo', id_paciente_mae: 'ID_Paciente_Mae', id_paciente_rn: 'ID_Paciente_RN' },
  pacientes: { id_paciente: 'ID_Paciente', nome: 'Nome', data_nascimento: 'Data_Nascimento', sexo: 'Sexo', numero_prontuario: 'Numero_Prontuario', cpf: 'CPF', cartao_sus: 'Cartao_SUS', telefone: 'Telefone', nome_mae: 'Nome_Mae' },
  internacoes: { id_internacao: 'ID_Internacao', id_paciente: 'ID_Paciente', id_leito: 'ID_Leito', numero_leito: 'Numero_Leito_Hist', setor_nome: 'ID_Setor', data_hora_entrada: 'Data_Hora_Entrada', procedencia: 'Procedencia', tipo_parto: 'Tipo_Parto', peso_nascer: 'Peso_Nascer', status: 'Status', hora_nascimento: 'Hora_Nascimento', ig: 'IG', gravidade: 'Gravidade', tipo_paciente: 'Tipo_Paciente', observacao_procedimento: 'Observacao_Procedimento', rn_sozinho: 'RN_Sozinho', status_regulacao: 'Status_Regulacao',
    // FASE 4 — dados de nascimento do RN e vínculo do binômio Mãe-Bebê.
    apgar_1min: 'APGAR_1min', apgar_5min: 'APGAR_5min', peso_gramas: 'Peso_Gramas', reanimacao: 'Reanimacao', pulseira: 'Pulseira', id_binomio: 'ID_Binomio' },
  evolucoes_soap: { id_evolucao: 'ID_Evolucao', id_internacao: 'ID_Internacao', id_paciente: 'ID_Paciente', setor_nome: 'ID_Setor', data_hora: 'Data_Hora', categoria: 'Categoria', profissional: 'Profissional', subjetivo: 'Subjetivo', objetivo: 'Objetivo', avaliacao: 'Avaliacao', plano: 'Plano', registrado_por: 'Registrado_Por', excluido: 'Excluido', excluido_por: 'Excluido_Por', excluido_em: 'Excluido_Em', atualizado_em: 'Atualizado_Em' },
  prescricoes: { id_prescricao: 'ID_Prescricao', id_internacao: 'ID_Internacao', id_paciente: 'ID_Paciente', setor_nome: 'ID_Setor', data_hora: 'Data_Hora', tipo: 'Tipo', descricao: 'Descricao', dose: 'Dose', via: 'Via', frequencia: 'Frequencia', status: 'Status', profissional: 'Profissional', observacao: 'Observacao' },
  movimentacoes: { id_movimentacao: 'ID_Movimentacao', id_internacao: 'ID_Internacao', tipo_movimento: 'Tipo_Movimento', data_hora_saida: 'Data_Hora_Saida', destino: 'Destino', observacao: 'Observacao', peso_saida_gramas: 'Peso_Saida_Gramas', aleitamento_exclusivo_alta: 'Aleitamento_Exclusivo_Alta', etapa_metodo_canguru: 'Etapa_Metodo_Canguru' },
  contato_pele_pele: { id_pele_pele: 'ID_Pele_Pele', id_internacao: 'ID_Internacao', id_paciente: 'ID_Paciente', id_leito: 'ID_Leito', setor_nome: 'ID_Setor', data_contato: 'Data_Contato', contato_realizado: 'Contato_Realizado', duracao_min: 'Duracao_Min', dia_vida: 'Dia_Vida', registrado_por: 'Registrado_Por', data_hora_registro: 'Data_Hora_Registro' },
  indicadores_leito: { id_indicador: 'ID_Indicador', id_internacao: 'ID_Internacao', id_paciente: 'ID_Paciente', id_leito: 'ID_Leito', setor_nome: 'ID_Setor', data: 'Data', extracao_leite_beira_leito: 'Extracao_Leite_Beira_Leito', visita_mae: 'Visita_Mae', visita_pai: 'Visita_Pai', visita_irmao: 'Visita_Irmao', visita_avos: 'Visita_Avos', registrado_por: 'Registrado_Por', data_hora_registro: 'Data_Hora_Registro' }
};
function selectCols(tabela, alias) {
  const a = alias ? alias + '.' : '';
  return Object.entries(COLS[tabela]).map(([c, k]) => `${a}${c} AS "${k}"`).join(', ');
}

module.exports = { query, transacao, getPool, COLS, selectCols };
