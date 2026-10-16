const { query, selectCols } = require('./db');
const U = require('./util');
const { formatarDataStr, formatarHoraStr, formatarDataHoraStr, paraData } = U;
const S = v => String(v == null ? '' : v).trim();

async function buscarPacientesPorNome(ctx, nomeBusca) {
  const termo = S(nomeBusca).toUpperCase();
  if (termo.length < 2) throw new Error('Digite ao menos 2 letras do nome para buscar.');
  const like = '%' + termo.replace(/[\\%_]/g, m => '\\' + m) + '%';
  const { rows } = await query(`SELECT p.id_paciente, p.nome, p.data_nascimento, p.sexo,
      (SELECT count(*)::int FROM internacoes i WHERE i.id_paciente=p.id_paciente) AS total
    FROM pacientes p WHERE upper(p.nome) LIKE $1 ORDER BY p.nome LIMIT 500`, [like]);
  return rows.map(p => ({ idPaciente: p.id_paciente, nome: p.nome, dataNascimento: formatarDataStr(p.data_nascimento), sexo: p.sexo, totalInternacoes: p.total }));
}

async function obterHistoricoPaciente(ctx, idPaciente) {
  const id = S(idPaciente);
  if (!id) throw new Error('Paciente não informado.');
  const p = (await query(`SELECT ${selectCols('pacientes')} FROM pacientes WHERE id_paciente=$1`, [id])).rows[0];
  if (!p) throw new Error('Paciente não encontrado.');
  const ints = (await query(`SELECT ${selectCols('internacoes', 'i')}, l.numero_leito AS "Numero_Leito_Atual" FROM internacoes i LEFT JOIN leitos l ON l.id_leito=i.id_leito WHERE i.id_paciente=$1 ORDER BY i.data_hora_entrada`, [id])).rows;
  const ids = ints.map(i => i.ID_Internacao);
  const movs = ids.length ? (await query(`SELECT ${selectCols('movimentacoes')} FROM movimentacoes WHERE id_internacao = ANY($1) ORDER BY data_hora_saida`, [ids])).rows : [];
  const internacoes = ints.map(i => {
    const mov = movs.find(m => String(m.ID_Internacao) === String(i.ID_Internacao));
    return {
      idInternacao: i.ID_Internacao, setor: i.ID_Setor,
      leito: i.Numero_Leito_Atual || i.Numero_Leito_Hist || (S(i.ID_Leito) ? i.ID_Leito : 'Sem leito atribuído'),
      dataHoraEntrada: formatarDataHoraStr(i.Data_Hora_Entrada), procedencia: i.Procedencia || '', tipoParto: i.Tipo_Parto || '', pesoNascer: i.Peso_Nascer || '',
      horaNascimento: formatarHoraStr(i.Hora_Nascimento), ig: i.IG || '', statusInternacao: i.Status || '',
      tipoSaida: mov ? mov.Tipo_Movimento : '', destinoSaida: mov ? mov.Destino : '', dataHoraSaida: mov ? formatarDataHoraStr(mov.Data_Hora_Saida) : '',
      pesoSaidaGramas: mov ? (mov.Peso_Saida_Gramas ?? '') : '', aleitamentoExclusivoAlta: mov ? (mov.Aleitamento_Exclusivo_Alta || '') : '',
      etapaMetodoCanguru: mov ? (mov.Etapa_Metodo_Canguru || '') : '', observacaoSaida: mov ? (mov.Observacao || '') : ''
    };
  });
  return { paciente: { idPaciente: p.ID_Paciente, nome: p.Nome, numeroProntuario: p.Numero_Prontuario || '', dataNascimento: formatarDataStr(p.Data_Nascimento), sexo: p.Sexo }, internacoes };
}
module.exports = { buscarPacientesPorNome, obterHistoricoPaciente };
