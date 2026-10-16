const { query, transacao } = require('./db');
const { criarContexto } = require('./data');
const R = require('./regras');
const U = require('./util');
const { registrarLog } = require('./log');
const { obterInternacoesHojeAlcon } = require('./calc');
const { formatarDataStr, formatarHoraStr, formatarDataHoraStr, upper } = U;
const { SETOR_UEN, ehSetorAlcon, SETORES_PADRAO } = R;
const S = v => String(v == null ? '' : v).trim();

/* UEN: leitos virtuais renumerados em sequência ("LT Extra-01", ...). */
async function normalizarLeitosExtra(client) {
  const { rows } = await client.query(`SELECT id_leito, numero_leito FROM leitos WHERE upper(setor_nome)=$1 ORDER BY id_leito`, [SETOR_UEN]);
  let seq = 0;
  for (const r of rows) {
    seq++;
    const novo = 'LT Extra-' + String(seq).padStart(2, '0');
    if (S(r.numero_leito) !== novo) await client.query('UPDATE leitos SET numero_leito=$2 WHERE id_leito=$1', [r.id_leito, novo]);
  }
}

/* ALCON: ressincroniza os vínculos Mãe/RN do leito a partir das internações ativas. */
async function sincronizarVinculosAlcon(client, setor) {
  const ints = (await client.query(`SELECT id_paciente, id_leito, tipo_paciente FROM internacoes WHERE upper(setor_nome)=upper($1) AND status='Ativo' AND coalesce(id_leito,'')<>''`, [setor])).rows;
  const ativos = {};
  for (const i of ints) {
    const leitoId = S(i.id_leito), tipo = upper(i.tipo_paciente), idPac = S(i.id_paciente);
    if (!idPac) continue;
    ativos[leitoId] = ativos[leitoId] || { mae: '', rn: '' };
    if (tipo === 'MAE' || tipo === 'MÃE') ativos[leitoId].mae = idPac;
    else if (tipo === 'RN') ativos[leitoId].rn = idPac;
    else if (!ativos[leitoId].rn) ativos[leitoId].rn = idPac;
  }
  const leitos = (await client.query(`SELECT id_leito, status, id_paciente_atual, id_paciente_mae, id_paciente_rn FROM leitos WHERE upper(setor_nome)=upper($1)`, [setor])).rows;
  for (const l of leitos) {
    const v = ativos[S(l.id_leito)] || { mae: '', rn: '' };
    const principal = v.mae || v.rn || '';
    const status = S(l.status);
    const novoStatus = (v.mae || v.rn) ? 'Ocupado' : (status === 'Ocupado' ? 'Livre' : status);
    const mudou = S(l.id_paciente_mae) !== v.mae || S(l.id_paciente_rn) !== v.rn || S(l.id_paciente_atual) !== principal ||
      (novoStatus !== status && (status === 'Livre' || status === 'Ocupado'));
    if (!mudou) continue;
    await client.query(`UPDATE leitos SET id_paciente_mae=$2, id_paciente_rn=$3, id_paciente_atual=$4, status=$5 WHERE id_leito=$1`,
      [l.id_leito, v.mae || null, v.rn || null, principal || null,
       (novoStatus !== status && (status === 'Livre' || status === 'Ocupado')) ? novoStatus : status]);
  }
}

/* Painel operacional de um setor (grade de leitos + KPIs do dia). */
async function getPainelOperacionalData(ctx, setorAtual) {
  setorAtual = S(setorAtual) || 'UTIN 1';
  if (upper(setorAtual) === SETOR_UEN || ehSetorAlcon(setorAtual)) {
    await transacao(async client => {
      if (upper(setorAtual) === SETOR_UEN) await normalizarLeitosExtra(client);
      if (ehSetorAlcon(setorAtual)) await sincronizarVinculosAlcon(client, setorAtual);
    });
  }
  const D = criarContexto();
  const [todosSetores, leitos, internacoes, movimentacoes, pacientes] = await Promise.all([
    D.setores(), D.leitos(setorAtual), D.internacoes(setorAtual), D.movimentacoes(setorAtual), D.pacientes(setorAtual)]);
  const hoje = new Date();
  const strHoje = formatarDataStr(hoje);
  const ehAlcon = ehSetorAlcon(setorAtual);
  const mapaPac = new Map(pacientes.map(p => [String(p.ID_Paciente), p]));
  const ativaDoPaciente = new Map();
  internacoes.forEach(i => { if (S(i.Status) === 'Ativo' && !ativaDoPaciente.has(String(i.ID_Paciente))) ativaDoPaciente.set(String(i.ID_Paciente), i); });

  const leitosComDetalhes = leitos.map(leito => {
    let pacInfo = null, intInfo = null, diasInternado = 0, erroCarregamento = '';
    try {
      if (S(leito.Status) === 'Ocupado') {
        const idPrincipal = ehAlcon ? S(leito.ID_Paciente_Mae || leito.ID_Paciente_RN || leito.ID_Paciente_Atual) : S(leito.ID_Paciente_Atual);
        if (idPrincipal) {
          pacInfo = mapaPac.get(idPrincipal) || null;
          intInfo = ativaDoPaciente.get(idPrincipal) || null;
          if (intInfo && intInfo.Data_Hora_Entrada) {
            const dtInt = new Date(intInfo.Data_Hora_Entrada);
            const d1 = new Date(dtInt.getFullYear(), dtInt.getMonth(), dtInt.getDate());
            const d2 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
            diasInternado = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
          }
        }
      }
    } catch (e) {
      erroCarregamento = String(e && e.message ? e.message : e);
      registrarLog(null, 'Sistema', 'ERRO_CARREGAR_LEITO', `Leito ${leito.ID_Leito}: ${erroCarregamento}`);
    }
    const nomeDe = id => { const p = mapaPac.get(String(id || '')); return p ? p.Nome : ''; };
    return {
      ...leito,
      idPaciente: pacInfo ? pacInfo.ID_Paciente : '',
      idInternacao: intInfo ? intInfo.ID_Internacao : '',
      pacienteNome: pacInfo ? pacInfo.Nome : (erroCarregamento ? 'Erro ao carregar dados' : 'Sem Cadastro'),
      numeroProntuario: pacInfo ? (pacInfo.Numero_Prontuario || '') : '',
      dataNascimento: pacInfo ? formatarDataStr(pacInfo.Data_Nascimento) : '',
      sexo: pacInfo ? pacInfo.Sexo : 'M',
      procedencia: intInfo ? intInfo.Procedencia : '',
      tipoParto: intInfo ? intInfo.Tipo_Parto : '',
      pesoNascer: intInfo ? intInfo.Peso_Nascer : '',
      horaNascimento: intInfo ? formatarHoraStr(intInfo.Hora_Nascimento) : '',
      ig: intInfo ? (intInfo.IG || '') : '',
      dataInternacao: intInfo ? formatarDataStr(intInfo.Data_Hora_Entrada) : '',
      dataHoraInternacaoCompleta: intInfo ? formatarDataHoraStr(intInfo.Data_Hora_Entrada) : '',
      gravidade: intInfo ? (intInfo.Gravidade || '') : '',
      tipoPaciente: intInfo ? (intInfo.Tipo_Paciente || '') : '',
      observacaoProcedimento: intInfo ? (intInfo.Observacao_Procedimento || '') : '',
      idPacienteMae: leito.ID_Paciente_Mae || '',
      idPacienteRN: leito.ID_Paciente_RN || '',
      nomeMae: nomeDe(leito.ID_Paciente_Mae),
      nomeRN: nomeDe(leito.ID_Paciente_RN),
      diasInternado, erroCarregamento
    };
  });

  const internadosAtivos = [];
  const itemAlcon = (idPac, tipo, numeroLeito, padraoNome, padraoSexo) => {
    const p = mapaPac.get(String(idPac));
    const ii = ativaDoPaciente.get(String(idPac));
    if (!ii) return;
    internadosAtivos.push({ idPaciente: idPac, idInternacao: ii.ID_Internacao, nome: p ? p.Nome : padraoNome, numeroLeito, tipoPaciente: tipo,
      pesoNascer: ii.Peso_Nascer || '', procedencia: ii.Procedencia || '', tipoParto: ii.Tipo_Parto || '', horaNascimento: formatarHoraStr(ii.Hora_Nascimento),
      ig: ii.IG || '', dataNascimento: p ? formatarDataStr(p.Data_Nascimento) : '', sexo: p ? p.Sexo : padraoSexo, observacaoProcedimento: ii.Observacao_Procedimento || '' });
  };
  leitosComDetalhes.forEach(l => {
    if (S(l.Status) !== 'Ocupado') return;
    if (ehAlcon) {
      if (l.idPacienteMae) itemAlcon(l.idPacienteMae, 'MAE', l.Numero_Leito, 'Mãe', 'F');
      if (l.idPacienteRN) itemAlcon(l.idPacienteRN, 'RN', l.Numero_Leito, 'RN', 'F');
    } else if (l.idPaciente) {
      internadosAtivos.push({ idPaciente: l.idPaciente, idInternacao: l.idInternacao, nome: l.pacienteNome, numeroLeito: l.Numero_Leito });
    }
  });

  const pacientesSemLeito = internacoes
    .filter(i => S(i.ID_Leito) === '' && S(i.Status) === 'Ativo')
    .map(i => { const p = mapaPac.get(String(i.ID_Paciente));
      return { idPaciente: i.ID_Paciente, idInternacao: i.ID_Internacao, nome: p ? p.Nome : 'Sem Cadastro', dataInternacao: formatarDataStr(i.Data_Hora_Entrada), procedencia: i.Procedencia || '' }; });

  const hojeBrutas = internacoes.filter(i => formatarDataStr(i.Data_Hora_Entrada) === strHoje);
  const hojeLista = ehAlcon ? obterInternacoesHojeAlcon(internacoes, movimentacoes, strHoje) : hojeBrutas;
  const intsHoje = hojeLista.length;
  const internacoesInternasHoje = hojeLista.filter(i => R.classificarProcedenciaInterna(i.Procedencia)).length;
  const movHoje = tipo => movimentacoes.filter(m => S(m.Tipo_Movimento) === tipo && formatarDataStr(m.Data_Hora_Saida) === strHoje);
  const transfLista = movHoje('Transferencia');
  const transferenciasInternasHoje = transfLista.filter(m => R.classificarMovimentoInterno(m.Destino)).length;
  const totalLeitos = leitosComDetalhes.length;
  const ocupados = leitosComDetalhes.filter(l => S(l.Status) === 'Ocupado').length;

  return {
    setorAtual,
    listaSetores: todosSetores.length > 0 ? todosSetores.map(s => s.Nome_Setor) : SETORES_PADRAO,
    leitos: leitosComDetalhes, internadosAtivos, pacientesSemLeito,
    resumo: {
      totalLeitos, ocupados,
      taxaOcupacaoDiaria: totalLeitos > 0 ? ((ocupados / totalLeitos) * 100).toFixed(1) : '0.0',
      internacoesHoje: intsHoje, internacoesInternasHoje, internacoesExternasHoje: intsHoje - internacoesInternasHoje,
      altasHoje: movHoje('Alta').length, obitosHoje: movHoje('Obito').length, evasoesHoje: movHoje('Evasao').length,
      transferenciasHoje: transfLista.length, transferenciasInternasHoje, transferenciasExternasHoje: transfLista.length - transferenciasInternasHoje
    }
  };
}

async function obterDadosNIR(ctx) {
  const D = criarContexto();
  const setores = await D.setores(), leitos = await D.leitos();
  const lista = setores.length ? setores.map(s => ({ nome: s.Nome_Setor, tipo: s.Tipo || '' })) : SETORES_PADRAO.map(n => ({ nome: n, tipo: '' }));
  return lista.map(({ nome, tipo }) => {
    const ls = leitos.filter(l => upper(l.ID_Setor) === upper(nome));
    const total = ls.length, ocupados = ls.filter(l => S(l.Status) === 'Ocupado').length, livres = ls.filter(l => S(l.Status) === 'Livre').length;
    const taxa = total > 0 ? Math.round((ocupados / total) * 100) : 0;
    return { setor: nome, tipo, ocupados, total, livres, taxa, statusCor: taxa >= 100 ? 'lotado' : taxa >= 90 ? 'atencao' : 'ok' };
  });
}

module.exports = { getPainelOperacionalData, obterDadosNIR, normalizarLeitosExtra, sincronizarVinculosAlcon };
