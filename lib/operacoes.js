const { query, transacao } = require('./db');
const { criarContexto } = require('./data');
const R = require('./regras');
const U = require('./util');
const { registrarLog } = require('./log');
const { exigirSetor, exigirAdministrativo, validarCPF, validarCartaoSUS } = require('./auth');
const { getPainelOperacionalData } = require('./painel');
const { SETOR_UEN, ehSetorAlcon, ehMae, classificarMovimentoInterno } = R;
const { upper, igual, novoId, montarDataHora } = U;
const S = v => String(v == null ? '' : v).trim();
const N = v => (S(v) === '' ? null : S(v));   // '' -> NULL
// Número inteiro opcional (APGAR, peso em gramas); '' -> null.
const inteiro = v => { const s = S(v); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? Math.trunc(n) : null; };
const usuarioDe = ctx => (ctx.sessao && ctx.sessao.nome) || 'Operador';

/* ---------------- helpers de leito (dentro de transação) ---------------- */
async function leitoPorId(c, id) { return (await c.query('SELECT * FROM leitos WHERE id_leito=$1', [id])).rows[0] || null; }
async function setLeito(c, id, p) {
  const cols = Object.keys(p);
  await c.query(`UPDATE leitos SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id_leito=$1`, [id, ...cols.map(k => p[k])]);
}
async function garantirSetorUEN(c) {
  await c.query(`INSERT INTO setores (id_setor, nome_setor, tipo, capacidade_inicial) VALUES ($1,$1,'Estabilização Neonatal (Vaga Zero)',0) ON CONFLICT (nome_setor) DO NOTHING`, [SETOR_UEN]);
}
async function criarLeitoUEN(c) {
  const { rows } = await c.query('SELECT numero_leito FROM leitos WHERE upper(setor_nome)=$1', [SETOR_UEN]);
  let maior = 0;
  rows.forEach(r => { const m = S(r.numero_leito).match(/(?:UEN|LT\s*Extra)[-\s]*(\d+)/i); if (m) maior = Math.max(maior, Number(m[1])); });
  const numero = 'LT Extra-' + String(maior + 1).padStart(2, '0');
  const idLeito = 'LEITO-UEN-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  await c.query(`INSERT INTO leitos (id_leito, setor_nome, numero_leito, status) VALUES ($1,$2,$3,'Livre')`, [idLeito, SETOR_UEN, numero]);
  return { idLeito, numero };
}
/* Fora da UEN o leito fica "Higienização Pendente" (aguardando limpeza) — FASE 5; na UEN o leito
 * virtual é extinto (DELETE). A equipe de higienização o devolve como "Livre" via concluirHigienizacao. */
async function liberarOuExtinguirLeito(c, leito) {
  if (!leito) return;
  if (upper(leito.setor_nome) === SETOR_UEN) await c.query('DELETE FROM leitos WHERE id_leito=$1', [leito.id_leito]);
  else await setLeito(c, leito.id_leito, { status: 'Higienizacao', id_paciente_atual: null, exame_externo: 'Não' });
}
/* ALCON: recalcula status/principal a partir de Mãe/RN do leito. Leito do binômio vazio = Higienização Pendente. */
async function fecharVinculosAlcon(c, leitoId, { liberarExame } = {}) {
  const l = await leitoPorId(c, leitoId);
  const mae = S(l.id_paciente_mae), rn = S(l.id_paciente_rn);
  const patch = { id_paciente_atual: N(mae || rn), status: (mae || rn) ? 'Ocupado' : 'Higienizacao' };
  if (liberarExame && !mae && !rn) patch.exame_externo = 'Não';
  await setLeito(c, leitoId, patch);
}

/* FASE 1 (ACR): reaproveita o cadastro quando o CPF/Cartão SUS informado já existe (ex.: paciente
 * que veio do acolhimento), evitando duplicidade; caso contrário cria um novo paciente. */
async function resolverPacienteInternacao(c, nome, sexo, cpf, cartaoSus, dados) {
  if (cpf || cartaoSus) {
    const campo = cpf ? `regexp_replace(cpf,'\\D','','g')=$1` : `regexp_replace(cartao_sus,'\\D','','g')=$1`;
    const existente = (await c.query(`SELECT id_paciente FROM pacientes WHERE ${campo} LIMIT 1`, [cpf || cartaoSus])).rows[0];
    if (existente) {
      await c.query(`UPDATE pacientes SET nome=$2, data_nascimento=coalesce($3,data_nascimento), sexo=coalesce($4,sexo),
          numero_prontuario=coalesce(nullif($5,''),numero_prontuario), cpf=coalesce(nullif($6,''),cpf),
          cartao_sus=coalesce(nullif($7,''),cartao_sus), telefone=coalesce(nullif($8,''),telefone),
          nome_mae=coalesce(nullif($9,''),nome_mae)
        WHERE id_paciente=$1`,
        [existente.id_paciente, nome, N(dados.dataNascimento), dados.sexo ? sexo : null, S(dados.numeroProntuario), cpf, cartaoSus, S(dados.telefone), S(dados.nomeMae)]);
      return existente.id_paciente;
    }
  }
  const idPaciente = novoId('PAC');
  await c.query('INSERT INTO pacientes (id_paciente, nome, data_nascimento, sexo, numero_prontuario, cpf, cartao_sus, telefone, nome_mae) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [idPaciente, nome, dados.dataNascimento, sexo, S(dados.numeroProntuario), cpf, cartaoSus, S(dados.telefone), S(dados.nomeMae)]);
  return idPaciente;
}

/* ---------------- internação ---------------- */
async function registrarInternacao(ctx, dados) {
  const setor = S(dados.setor);
  if (upper(setor) === SETOR_UEN) throw new Error('A UEN não admite pacientes por aqui: use o botão "Admitir Vaga Zero", que cria o leito virtual automaticamente.');
  exigirSetor(ctx, setor);
  return transacao(async c => {
    const ehAlcon = ehSetorAlcon(setor);
    const leitoId = S(dados.leitoId);
    if (!leitoId) throw new Error('Selecione o leito.');
    const leito = await leitoPorId(c, leitoId);
    if (!leito) throw new Error('Leito não encontrado. Atualize a tela e tente novamente.');
    if (!igual(leito.setor_nome, setor)) throw new Error('O leito selecionado não pertence ao setor.');

    const tipoPaciente = ehAlcon ? upper(dados.tipoPaciente || 'RN') : '';
    if (ehAlcon && !['MAE', 'MÃE', 'RN'].includes(tipoPaciente)) throw new Error('Selecione se a internação é da Mãe ou do RN.');
    const ocupado = upper(leito.status) === 'OCUPADO';
    if (!ehAlcon && ocupado) throw new Error('Este leito já está ocupado por outro paciente.');
    if (ehAlcon && ocupado) {
      const mae = S(leito.id_paciente_mae), rn = S(leito.id_paciente_rn);
      if (tipoPaciente === 'RN' && rn) throw new Error('Este leito já possui um RN internado.');
      if (ehMae(tipoPaciente) && mae) throw new Error('Este leito já possui uma Mãe internada.');
      if (!mae && !rn) throw new Error('O leito está marcado como ocupado, mas não há vínculo válido. Atualize a tela.');
    } else if (!ocupado && upper(leito.status) !== 'LIVRE') {
      throw new Error('O leito selecionado não está disponível.');
    }

    const nome = S(dados.nome);
    if (!nome) throw new Error('Informe o nome do paciente.');
    const sexo = ehAlcon && ehMae(tipoPaciente) ? 'F' : (dados.sexo || 'F');
    if (!dados.dataNascimento) throw new Error('Informe a data de nascimento.');
    const procedencia = S(dados.procedencia);
    if (!procedencia) throw new Error('Informe a procedência.');

    const dataHora = montarDataHora(dados.data, dados.hora);
    // FASE 1 (ACR): documentos opcionais coletados na busca rápida da admissão.
    const cpf = U.somenteDigitos(dados.cpf), cartaoSus = U.somenteDigitos(dados.cartaoSus);
    if (cpf && !validarCPF(cpf)) throw new Error('CPF inválido. Corrija ou deixe o campo vazio.');
    if (cartaoSus && !validarCartaoSUS(cartaoSus)) throw new Error('Cartão SUS inválido. Corrija ou deixe o campo vazio.');
    // Reaproveita o paciente já vinculado (ex.: internação pelo card do Kanban/prontuário); caso
    // contrário, resolve por CPF/Cartão SUS e só então cria um novo cadastro (evita duplicidade ACR).
    const idInformado = S(dados.idPaciente);
    let idPaciente;
    if (idInformado) {
      const ex = (await c.query('SELECT id_paciente FROM pacientes WHERE id_paciente=$1', [idInformado])).rows[0];
      if (!ex) throw new Error('Paciente informado não encontrado.');
      idPaciente = idInformado;
    } else {
      idPaciente = await resolverPacienteInternacao(c, nome, sexo, cpf, cartaoSus, dados);
    }

    const idInternacao = novoId('INT');
    const maeSemRN = ehAlcon && ehMae(tipoPaciente);
    // A mãe (ALCON) não possui faixa de peso/dados de nascimento; a UTI Materna também não usa peso ao nascer.
    const maeSemPeso = maeSemRN || upper(setor) === 'UTI MATERNA';
    const tipoParto = ehAlcon && dados.tipoProcedimento ? dados.tipoProcedimento : (dados.tipoParto || '');
    const observacao = ehAlcon || upper(setor) === 'UTI MATERNA' ? (dados.observacaoProcedimento || '') : '';
    const rnSozinho = ehAlcon && tipoPaciente === 'RN' && !S(leito.id_paciente_mae) ? 'Sim' : '';
    // FASE 4: dados ao nascer (APGAR, peso em gramas, reanimação, pulseira) e vínculo do binômio.
    const apgar1 = maeSemRN ? null : inteiro(dados.apgar1);
    const apgar5 = maeSemRN ? null : inteiro(dados.apgar5);
    const pesoGramas = maeSemPeso ? null : inteiro(dados.pesoGramas);
    const reanimacao = maeSemRN ? '' : S(dados.reanimacao);
    const pulseira = S(dados.pulseira);
    let idBinomio = '';
    if (ehAlcon) {
      if (ehMae(tipoPaciente)) idBinomio = novoId('BIN');
      else {
        // O RN herda o identificador do binômio da Mãe já interna no leito (quando houver).
        const maeId = S(leito.id_paciente_mae);
        const m = maeId ? (await c.query(`SELECT id_binomio FROM internacoes WHERE id_paciente=$1 AND status='Ativo' AND id_binomio<>'' ORDER BY data_hora_entrada DESC LIMIT 1`, [maeId])).rows[0] : null;
        idBinomio = (m && m.id_binomio) ? m.id_binomio : novoId('BIN');
      }
    }
    await c.query(`INSERT INTO internacoes (id_internacao,id_paciente,id_leito,numero_leito,setor_nome,data_hora_entrada,procedencia,tipo_parto,peso_nascer,status,hora_nascimento,ig,gravidade,tipo_paciente,observacao_procedimento,rn_sozinho,apgar_1min,apgar_5min,peso_gramas,reanimacao,pulseira,id_binomio)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Ativo',$10,$11,'',$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [idInternacao, idPaciente, leitoId, leito.numero_leito, leito.setor_nome, dataHora, procedencia, tipoParto,
       maeSemPeso ? '' : (dados.pesoNascer || ''), maeSemRN ? '' : (dados.horaNascimento || ''), maeSemRN ? '' : (dados.ig || ''),
       tipoPaciente, observacao, rnSozinho, apgar1, apgar5, pesoGramas, reanimacao, pulseira, idBinomio]);

    if (ehAlcon) {
      await setLeito(c, leitoId, ehMae(tipoPaciente) ? { id_paciente_mae: idPaciente } : { id_paciente_rn: idPaciente });
      await setLeito(c, leitoId, { status: 'Ocupado' });
      await fecharVinculosAlcon(c, leitoId);
    } else {
      await setLeito(c, leitoId, { status: 'Ocupado', id_paciente_atual: idPaciente });
    }
    await registrarLog(c, usuarioDe(ctx), 'ADMITIR_PACIENTE', `Paciente ${nome} (ID: ${idPaciente}) admitido no setor ${setor} em ${dataHora}${ehAlcon ? ` como ${tipoPaciente}` : ''}.`);
    return { success: true, idInternacao };
  });
}

async function admitirVagaZeroUEN(ctx, dados) {
  exigirSetor(ctx, SETOR_UEN);
  return transacao(async c => {
    const nome = S(dados && dados.nome);
    if (!nome) throw new Error('Informe o nome da mãe/RN.');
    const dataHoraEntrada = montarDataHora(S(dados.data), S(dados.hora));
    const procedencia = S(dados.procedencia) || 'VAGA ZERO';
    await garantirSetorUEN(c);
    const leito = await criarLeitoUEN(c);
    const idPaciente = novoId('PAC');
    const cpfUEN = U.somenteDigitos(dados.cpf), susUEN = U.somenteDigitos(dados.cartaoSus);
    if (cpfUEN && !validarCPF(cpfUEN)) throw new Error('CPF inválido. Corrija ou deixe o campo vazio.');
    if (susUEN && !validarCartaoSUS(susUEN)) throw new Error('Cartão SUS inválido. Corrija ou deixe o campo vazio.');
    await c.query('INSERT INTO pacientes (id_paciente, nome, data_nascimento, sexo, numero_prontuario, cpf, cartao_sus, telefone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [idPaciente, nome, N(dados.dataNascimento), dados.sexo || 'M', S(dados.numeroProntuario), cpfUEN, susUEN, S(dados.telefone)]);
    const idInternacao = novoId('INT');
    await c.query(`INSERT INTO internacoes (id_internacao,id_paciente,id_leito,numero_leito,setor_nome,data_hora_entrada,procedencia,tipo_parto,peso_nascer,status,hora_nascimento,ig,gravidade,apgar_1min,apgar_5min,peso_gramas,reanimacao,pulseira)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Ativo',$10,$11,$12,$13,$14,$15,$16,$17)`,
      [idInternacao, idPaciente, leito.idLeito, leito.numero, SETOR_UEN, dataHoraEntrada, procedencia, dados.tipoParto || '', dados.pesoNascer || '', dados.horaNascimento || '', dados.ig || '', dados.gravidade || '',
       inteiro(dados.apgar1), inteiro(dados.apgar5), inteiro(dados.pesoGramas), S(dados.reanimacao), S(dados.pulseira)]);
    await setLeito(c, leito.idLeito, { status: 'Ocupado', id_paciente_atual: idPaciente });
    await registrarLog(c, usuarioDe(ctx), 'ADMITIR_VAGA_ZERO_UEN', `Vaga zero criada na UEN: leito ${leito.numero}, paciente ${nome} (ID ${idPaciente}), gravidade ${dados.gravidade || 'não informada'}, entrada ${dataHoraEntrada}.`);
    return { success: true, idInternacao, leito: leito.numero };
  });
}

/* ---------------- movimentação (saídas e transferências) ---------------- */
async function registrarMovimentacao(ctx, dados) {
  return transacao(async c => {
    const tipo = S(dados.tipoMovimento), destino = S(dados.destino);
    const dataHora = montarDataHora(dados.data, dados.hora);
    if (!['Alta', 'Obito', 'Evasao', 'Transferencia'].includes(tipo)) throw new Error('Tipo de movimentação inválido.');

    const intAtual = (await c.query(`SELECT * FROM internacoes WHERE id_internacao=$1 AND status='Ativo'`, [S(dados.idInternacao)])).rows[0];
    if (!intAtual) throw new Error('Internação ativa não encontrada. Atualize a tela e tente novamente.');
    exigirSetor(ctx, intAtual.setor_nome);
    const setorAtual = S(intAtual.setor_nome);          // setor de origem (autoritativo)
    const ehAlconOrigem = ehSetorAlcon(setorAtual);
    let leitoDestinoId = S(dados.leitoDestinoId);

    const pesoStr = S(dados.pesoSaidaGramas);
    const pesoSaida = pesoStr !== '' && !isNaN(Number(pesoStr)) ? Number(pesoStr) : null;
    if (tipo === 'Alta' && upper(setorAtual) === 'UCINCA' && pesoSaida === null) throw new Error('Informe o peso do RN na saída (obrigatório para Altas registradas na UCINCA).');
    if (tipo === 'Evasao' && !ehAlconOrigem) throw new Error('Evasão está disponível somente nos setores ALCON 1 e ALCON 2.');
    if (tipo === 'Transferencia') {
      if (!destino) throw new Error('Selecione o destino da transferência.');
      if (igual(destino, setorAtual)) throw new Error('O destino não pode ser o mesmo setor da internação atual. Para mudar apenas de leito, use a opção Trocar Leito.');
    }

    await c.query(`INSERT INTO movimentacoes (id_movimentacao,id_internacao,tipo_movimento,data_hora_saida,destino,observacao,peso_saida_gramas,aleitamento_exclusivo_alta,etapa_metodo_canguru)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [novoId('MOV'), intAtual.id_internacao, tipo, dataHora, destino, dados.observacao || '', pesoSaida,
       tipo === 'Alta' ? S(dados.aleitamentoExclusivo) : '', tipo === 'Alta' ? S(dados.etapaCanguru) : '']);

    const tipoPacienteAtual = upper(intAtual.tipo_paciente);
    const leitoOrigemId = S(intAtual.id_leito);
    const leitoOrigem = leitoOrigemId ? await leitoPorId(c, leitoOrigemId) : null;
    const usuario = usuarioDe(ctx);
    const setStatusInt = (id, st) => c.query('UPDATE internacoes SET status=$2 WHERE id_internacao=$1', [id, st]);

    // ALCON: Alta da Mãe mantém o RN no leito e abre nova internação (Tratamento Clínico) para ele.
    if (ehAlconOrigem && tipo === 'Alta' && ehMae(tipoPacienteAtual)) {
      if (!leitoOrigem) throw new Error('Leito de origem não encontrado para o binômio.');
      const rnId = S(leitoOrigem.id_paciente_rn);
      await setStatusInt(intAtual.id_internacao, 'Alta');
      if (!rnId) {
        await setLeito(c, leitoOrigemId, { id_paciente_mae: null, id_paciente_atual: null, status: 'Higienizacao' });
        await registrarLog(c, usuario, 'ALTA_MAE_ALCON', `Alta da Mãe ${intAtual.id_paciente} no ${setorAtual}; não havia RN vinculado no leito ${leitoOrigemId} (Higienização Pendente).`);
        return { success: true, transferenciaInterna: false };
      }
      await setLeito(c, leitoOrigemId, { id_paciente_mae: null, status: 'Ocupado', id_paciente_atual: rnId });
      const rnRow = (await c.query(`SELECT * FROM internacoes WHERE id_paciente=$1 AND status='Ativo' ORDER BY data_hora_entrada LIMIT 1`, [rnId])).rows[0];
      if (rnRow) await c.query(`UPDATE internacoes SET status='Encerrado - Binômio' WHERE id_internacao=$1`, [rnRow.id_internacao]);
      const novaIdRN = novoId('INT', 'RNCLIN');
      const rnNome = (await c.query('SELECT nome FROM pacientes WHERE id_paciente=$1', [rnId])).rows[0];
      await c.query(`INSERT INTO internacoes (id_internacao,id_paciente,id_leito,numero_leito,setor_nome,data_hora_entrada,procedencia,tipo_parto,peso_nascer,status,hora_nascimento,ig,gravidade,tipo_paciente,observacao_procedimento,rn_sozinho,apgar_1min,apgar_5min,peso_gramas,reanimacao,pulseira,id_binomio)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'Tratamento Clínico','','Ativo',$8,$9,'','RN','RN permaneceu internado após alta da Mãe.','Sim',$10,$11,$12,$13,$14,$15)`,
        [novaIdRN, rnId, leitoOrigemId, leitoOrigem.numero_leito, setorAtual, dataHora, setorAtual,
         (rnRow && rnRow.hora_nascimento) || intAtual.hora_nascimento || '', (rnRow && rnRow.ig) || intAtual.ig || '',
         rnRow ? rnRow.apgar_1min : null, rnRow ? rnRow.apgar_5min : null, rnRow ? rnRow.peso_gramas : null,
         (rnRow && rnRow.reanimacao) || '', (rnRow && rnRow.pulseira) || '', (rnRow && rnRow.id_binomio) || '']);
      await registrarLog(c, usuario, 'ALTA_MAE_MANTEM_RN', `Alta da Mãe ${intAtual.id_paciente} no ${setorAtual}; RN ${rnNome ? rnNome.nome : 'RN'} permaneceu no leito ${leitoOrigemId} e recebeu nova internação para Tratamento Clínico (${novaIdRN}).`);
      return { success: true, transferenciaInterna: false, altaMaeMantemRN: true, novaIdInternacaoRN: novaIdRN };
    }

    // ALCON: saída de um integrante libera apenas o vínculo dele; o outro mantém o leito ocupado.
    if (ehAlconOrigem) {
      if (!leitoOrigem) throw new Error('Leito de origem não encontrado para o binômio.');
      await setStatusInt(intAtual.id_internacao, tipo);
      if (tipoPacienteAtual === 'RN') await setLeito(c, leitoOrigemId, { id_paciente_rn: null });
      else if (ehMae(tipoPacienteAtual)) await setLeito(c, leitoOrigemId, { id_paciente_mae: null });
      await fecharVinculosAlcon(c, leitoOrigemId);
      const l2 = await leitoPorId(c, leitoOrigemId);
      await registrarLog(c, usuario, 'REGISTRAR_SAIDA_ALCON', `Saída ${tipo} no ${setorAtual}, paciente ${intAtual.id_internacao}; vínculos restantes: Mãe=${S(l2.id_paciente_mae) || '-'}, RN=${S(l2.id_paciente_rn) || '-'}.`);
      return { success: true, transferenciaInterna: false };
    }

    // UEN: destino UEN sem leito escolhido -> cria o próximo leito virtual.
    if (tipo === 'Transferencia' && upper(destino) === SETOR_UEN && !leitoDestinoId) {
      await garantirSetorUEN(c);
      leitoDestinoId = (await criarLeitoUEN(c)).idLeito;
    }

    if (tipo === 'Transferencia' && classificarMovimentoInterno(destino)) {
      const totalDestino = (await c.query('SELECT count(*)::int n FROM leitos WHERE upper(setor_nome)=upper($1)', [destino])).rows[0].n;
      if (!leitoDestinoId) {
        if (totalDestino > 0) throw new Error('Selecione um leito disponível no setor de destino.');
        // Setor de destino sem leitos cadastrados: transfere sem leito (fica pendente de atribuição).
        await setStatusInt(intAtual.id_internacao, 'Transferido');
        await liberarOuExtinguirLeito(c, leitoOrigem);
        const novaId = novoId('INT', 'TR');
        await c.query(`INSERT INTO internacoes (id_internacao,id_paciente,id_leito,numero_leito,setor_nome,data_hora_entrada,procedencia,tipo_parto,peso_nascer,status,hora_nascimento,ig,apgar_1min,apgar_5min,peso_gramas,reanimacao,pulseira,id_binomio)
          VALUES ($1,$2,NULL,'',$3,$4,$5,$6,$7,'Ativo',$8,$9,$10,$11,$12,$13,$14,$15)`,
          [novaId, intAtual.id_paciente, destino, dataHora, setorAtual, intAtual.tipo_parto, intAtual.peso_nascer, intAtual.hora_nascimento, intAtual.ig,
           intAtual.apgar_1min, intAtual.apgar_5min, intAtual.peso_gramas, intAtual.reanimacao || '', intAtual.pulseira || '', intAtual.id_binomio || '']);
        await registrarLog(c, usuario, 'TRANSFERENCIA_INTERNA_SEM_LEITO', `Paciente ID ${intAtual.id_paciente} transferido de ${setorAtual} / ${leitoOrigemId} para ${destino} (setor sem leitos cadastrados no sistema). Saída ${dataHora}. Nova internação ${novaId}.`);
        return { success: true, transferenciaInterna: true, novaIdInternacao: novaId, semLeitoDestino: true };
      }

      const leitoDest = await leitoPorId(c, leitoDestinoId);
      if (!leitoDest) throw new Error('Leito de destino não encontrado.');
      const setorDestino = S(leitoDest.setor_nome);
      if (!igual(setorDestino, destino)) throw new Error('O leito selecionado não pertence ao setor de destino.');

      const destinoEhAlcon = ehSetorAlcon(setorDestino);
      let tipoDest = tipoPacienteAtual;
      if (destinoEhAlcon) {
        if (upper(setorAtual) === 'UTI MATERNA') tipoDest = 'MAE';
        else if (!['MAE', 'MÃE', 'RN'].includes(tipoDest)) tipoDest = 'RN';
        if (tipoDest === 'MÃE') tipoDest = 'MAE';
      }
      if (destinoEhAlcon && upper(leitoDest.status) === 'OCUPADO') {
        if (tipoDest === 'MAE' && S(leitoDest.id_paciente_mae)) throw new Error('Este leito já possui uma Mãe internada. Selecione outro leito.');
        if (tipoDest === 'RN' && S(leitoDest.id_paciente_rn)) throw new Error('Este leito já possui um RN internado. Selecione outro leito.');
      } else if (upper(leitoDest.status) !== 'LIVRE') {
        throw new Error('O leito selecionado não está mais disponível. Atualize a tela e escolha outro leito.');
      }

      await setStatusInt(intAtual.id_internacao, 'Transferido');
      const novaId = novoId('INT', 'TR');
      const rnSozinho = destinoEhAlcon && tipoDest === 'RN' && !S(leitoDest.id_paciente_mae) ? 'Sim' : '';
      await c.query(`INSERT INTO internacoes (id_internacao,id_paciente,id_leito,numero_leito,setor_nome,data_hora_entrada,procedencia,tipo_parto,peso_nascer,status,hora_nascimento,ig,gravidade,tipo_paciente,observacao_procedimento,rn_sozinho,apgar_1min,apgar_5min,peso_gramas,reanimacao,pulseira,id_binomio)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Ativo',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [novaId, intAtual.id_paciente, leitoDestinoId, leitoDest.numero_leito, setorDestino, dataHora, setorAtual, intAtual.tipo_parto, intAtual.peso_nascer,
         intAtual.hora_nascimento, intAtual.ig, intAtual.gravidade, destinoEhAlcon ? tipoDest : (intAtual.tipo_paciente || ''), intAtual.observacao_procedimento || '', rnSozinho,
         intAtual.apgar_1min, intAtual.apgar_5min, intAtual.peso_gramas, intAtual.reanimacao || '', intAtual.pulseira || '', intAtual.id_binomio || '']);
      if (destinoEhAlcon) {
        await setLeito(c, leitoDestinoId, tipoDest === 'MAE' ? { id_paciente_mae: intAtual.id_paciente } : { id_paciente_rn: intAtual.id_paciente });
        await setLeito(c, leitoDestinoId, { status: 'Ocupado' });
        await fecharVinculosAlcon(c, leitoDestinoId);
      } else {
        await setLeito(c, leitoDestinoId, { status: 'Ocupado', id_paciente_atual: intAtual.id_paciente });
      }
      await liberarOuExtinguirLeito(c, leitoOrigem);   // por último: na UEN remove a linha do leito
      await registrarLog(c, usuario, 'TRANSFERENCIA_INTERNA', `Paciente ID ${intAtual.id_paciente} transferido de ${setorAtual} / ${leitoOrigemId} para ${setorDestino} / ${leitoDestinoId}. Saída ${dataHora}. Nova internação ${novaId}.`);
      return { success: true, transferenciaInterna: true, novaIdInternacao: novaId };
    }

    // Altas, óbitos e transferências externas.
    await setStatusInt(intAtual.id_internacao, tipo);
    await liberarOuExtinguirLeito(c, leitoOrigem);
    await registrarLog(c, usuario, 'REGISTRAR_SAIDA', `Saída registrada: Tipo ${tipo}, Internação ${intAtual.id_internacao}, Destino ${destino || '-'}, Data/Hora ${dataHora}.`);
    return { success: true, transferenciaInterna: false };
  });
}

// A movimentação grava; a leitura do painel é feita depois e nunca repete a gravação.
async function registrarMovimentacaoAtualizarPainel(ctx, dados) {
  const resultado = await registrarMovimentacao(ctx, dados);
  if (!resultado || resultado.success !== true) return resultado;
  try {
    const setor = (await query('SELECT setor_nome FROM internacoes WHERE id_internacao=$1', [S(dados.idInternacao)])).rows[0];
    resultado.painel = await getPainelOperacionalData(ctx, S(dados.setorAtual) || (setor && setor.setor_nome));
  } catch (e) { resultado.atualizacaoPendente = true; }
  return resultado;
}

async function trocarLeito(ctx, dados) {
  return transacao(async c => {
    const idInternacao = S(dados.idInternacao), novoLeitoId = S(dados.novoLeitoId);
    if (!idInternacao || !novoLeitoId) throw new Error('Internação e novo leito são obrigatórios.');
    const it = (await c.query(`SELECT * FROM internacoes WHERE id_internacao=$1 AND status='Ativo'`, [idInternacao])).rows[0];
    if (!it) throw new Error('Internação ativa não encontrada.');
    exigirSetor(ctx, it.setor_nome);
    const setorInt = S(it.setor_nome);
    if (upper(setorInt) === SETOR_UEN) throw new Error('Não é possível trocar de leito dentro da UEN: os leitos são virtuais e criados sob demanda. Para mover o paciente, registre uma Saída (Alta/Óbito/Transferência).');
    const atualId = S(it.id_leito), semLeito = !atualId;
    const novo = await leitoPorId(c, novoLeitoId);
    const atual = semLeito ? null : await leitoPorId(c, atualId);
    if (!novo) throw new Error('Novo leito não encontrado.');
    if (!semLeito && !atual) throw new Error('Leito atual não encontrado.');
    if (S(novo.status) !== 'Livre') throw new Error('O novo leito não está disponível.');
    if (!igual(novo.setor_nome, setorInt)) throw new Error(semLeito ? 'O leito selecionado não pertence ao setor atual do paciente.' : 'A troca de leito deve ocorrer dentro do mesmo setor.');
    await c.query('UPDATE internacoes SET id_leito=$2, numero_leito=$3 WHERE id_internacao=$1', [idInternacao, novoLeitoId, novo.numero_leito]);
    // O leito de origem volta a "Livre" (comportamento histórico preservado). A troca é auditada
    // abaixo para não se perder a origem na reconstrução histórica da ocupação.
    if (!semLeito) await setLeito(c, atualId, { status: 'Livre', id_paciente_atual: null });
    await setLeito(c, novoLeitoId, { status: 'Ocupado', id_paciente_atual: it.id_paciente });
    // Auditoria da troca: preserva origem/destino com data/hora, garantindo a reconstrução histórica
    // da ocupação por leito mesmo com internacoes.id_leito sendo atualizado (in-place).
    if (!semLeito) {
      await c.query(`INSERT INTO trocas_leito (id_troca,id_internacao,id_paciente,setor_nome,leito_origem,numero_origem,leito_destino,numero_destino,data_hora,registrado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() AT TIME ZONE 'America/Manaus', $9)`,
        [novoId('TROCA'), idInternacao, it.id_paciente, setorInt, atualId, S(atual.numero_leito), novoLeitoId, S(novo.numero_leito), usuarioDe(ctx)]);
    }
    await registrarLog(c, usuarioDe(ctx), semLeito ? 'ATRIBUIR_LEITO' : 'TROCA_LEITO',
      semLeito ? `Leito ${novoLeitoId} atribuído ao paciente sem leito, Internação ${idInternacao}.` : `Troca de leito sem nova internação: ${atualId} -> ${novoLeitoId}, Internação ${idInternacao}. Registro de auditoria gravado.`);
    return { success: true };
  });
}

async function editarInternacao(ctx, dados) {
  return transacao(async c => {
    const it = (await c.query('SELECT * FROM internacoes WHERE id_internacao=$1', [S(dados.idInternacao)])).rows[0];
    if (!it) throw new Error('Internação não encontrada.');
    exigirSetor(ctx, it.setor_nome);
    if (S(it.id_paciente) !== S(dados.idPaciente)) throw new Error('Paciente não pertence à internação informada.');
    if (!S(dados.nome)) throw new Error('Informe o nome do paciente.');
    const cpfEdit = U.somenteDigitos(dados.cpf), susEdit = U.somenteDigitos(dados.cartaoSus);
    if (cpfEdit && !validarCPF(cpfEdit)) throw new Error('CPF inválido. Corrija ou deixe o campo vazio.');
    if (susEdit && !validarCartaoSUS(susEdit)) throw new Error('Cartão SUS inválido. Corrija ou deixe o campo vazio.');
    await c.query('UPDATE pacientes SET nome=$2, data_nascimento=$3, sexo=$4, numero_prontuario=$5, cpf=$6, cartao_sus=$7, telefone=$8, nome_mae=coalesce(nullif($9,\'\'),nome_mae) WHERE id_paciente=$1',
      [dados.idPaciente, S(dados.nome), N(dados.dataNascimento), N(dados.sexo), S(dados.numeroProntuario), cpfEdit, susEdit, S(dados.telefone), S(dados.nomeMae)]);
    const setorEdit = S(it.setor_nome);
    const maeAlcon = ehSetorAlcon(setorEdit) && upper(dados.tipoPaciente) === 'MAE';
    const semNasc = upper(setorEdit) === 'UTI MATERNA' || maeAlcon;
    const sets = { procedencia: dados.procedencia || '', tipo_parto: dados.tipoProcedimento || dados.tipoParto || it.tipo_parto,
      peso_nascer: maeAlcon ? '' : (dados.pesoNascer || ''), hora_nascimento: semNasc ? '' : (dados.horaNascimento || ''), ig: semNasc ? '' : (dados.ig || '') };
    if (dados.gravidade !== undefined) sets.gravidade = dados.gravidade || '';
    if (dados.tipoPaciente) sets.tipo_paciente = dados.tipoPaciente;
    if (dados.observacaoProcedimento !== undefined) sets.observacao_procedimento = dados.observacaoProcedimento || '';
    // FASE 4: dados ao nascer só são tocados quando enviados (preserva o que já existe).
    if (dados.apgar1 !== undefined) sets.apgar_1min = semNasc ? null : inteiro(dados.apgar1);
    if (dados.apgar5 !== undefined) sets.apgar_5min = semNasc ? null : inteiro(dados.apgar5);
    if (dados.pesoGramas !== undefined) sets.peso_gramas = maeAlcon ? null : inteiro(dados.pesoGramas);
    if (dados.reanimacao !== undefined) sets.reanimacao = semNasc ? '' : S(dados.reanimacao);
    if (dados.pulseira !== undefined) sets.pulseira = S(dados.pulseira);
    const cols = Object.keys(sets);
    await c.query(`UPDATE internacoes SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id_internacao=$1`, [it.id_internacao, ...cols.map(k => sets[k])]);
    await registrarLog(c, usuarioDe(ctx), 'EDITAR_INTERNACAO', `Dados alterados para o Paciente ID: ${dados.idPaciente}.`);
    return { success: true };
  });
}

/* ---------------- leitos ---------------- */
async function alterarStatusExameExterno(ctx, leitoId, emExame) {
  return transacao(async c => {
    const l = await leitoPorId(c, S(leitoId));
    if (!l) throw new Error('Leito não encontrado.');
    exigirSetor(ctx, l.setor_nome);
    if (S(l.status) !== 'Ocupado') throw new Error('O leito não está ocupado.');
    const v = emExame ? 'Sim' : 'Não';
    await setLeito(c, l.id_leito, { exame_externo: v });
    await registrarLog(c, usuarioDe(ctx), 'EXAME_EXTERNO', `Leito ${leitoId}: paciente ${v === 'Sim' ? 'saiu para exame externo' : 'retornou de exame externo'}.`);
    return { success: true, exameExterno: v === 'Sim' };
  });
}
async function alterarStatusLeito(ctx, leitoId, novoStatus) {
  return transacao(async c => {
    const l = await leitoPorId(c, S(leitoId));
    if (!l) throw new Error('Leito não encontrado.');
    exigirSetor(ctx, l.setor_nome);
    if (S(l.status) === 'Ocupado') throw new Error('Não é permitido alterar o status de um leito ocupado diretamente.');
    const st = S(novoStatus);
    if (!['Livre', 'Reservado', 'Reserva', 'Bloqueado', 'Higienizacao'].includes(st)) throw new Error('Status inválido. Use Livre, Reservado, Bloqueado ou Higienização.');
    await setLeito(c, l.id_leito, { status: st === 'Reserva' ? 'Reservado' : st, id_paciente_atual: null });
    await registrarLog(c, usuarioDe(ctx), 'ALTERAR_STATUS_LEITO', `Leito ID: ${leitoId} alterado para ${novoStatus}.`);
    return { success: true };
  });
}
/* FASE 5 — giro de leitos: a equipe de higienização devolve o leito à operação. */
async function concluirHigienizacao(ctx, leitoId) {
  return transacao(async c => {
    const l = await leitoPorId(c, S(leitoId));
    if (!l) throw new Error('Leito não encontrado.');
    exigirSetor(ctx, l.setor_nome);
    if (upper(l.status) !== 'HIGIENIZACAO') throw new Error('O leito não está em Higienização Pendente.');
    await setLeito(c, l.id_leito, { status: 'Livre', id_paciente_atual: null, exame_externo: 'Não' });
    await registrarLog(c, usuarioDe(ctx), 'HIGIENIZACAO_CONCLUIDA', `Leito ${l.numero_leito} (${l.setor_nome}) liberado para uso após higienização.`);
    return { success: true };
  });
}
async function marcarHigienizacao(ctx, leitoId) {
  return transacao(async c => {
    const l = await leitoPorId(c, S(leitoId));
    if (!l) throw new Error('Leito não encontrado.');
    exigirSetor(ctx, l.setor_nome);
    if (upper(l.status) === 'OCUPADO') throw new Error('Não é possível higienizar um leito ocupado.');
    await setLeito(c, l.id_leito, { status: 'Higienizacao', id_paciente_atual: null });
    await registrarLog(c, usuarioDe(ctx), 'HIGIENIZACAO_PENDENTE', `Leito ${l.numero_leito} (${l.setor_nome}) encaminhado para higienização.`);
    return { success: true };
  });
}
async function adicionarLeito(ctx, setor, numeroLeito) {
  if (upper(setor) === SETOR_UEN) throw new Error('Os leitos da UEN são criados automaticamente pelo sistema (Admitir Vaga Zero ou Transferência para UEN) - não é possível cadastrar um leito manualmente aqui.');
  exigirSetor(ctx, setor);
  const numero = S(numeroLeito);
  if (!numero) throw new Error('Informe o número do leito.');
  const s = (await query('SELECT nome_setor FROM setores WHERE upper(nome_setor)=upper($1)', [S(setor)])).rows[0];
  if (!s) throw new Error('Setor não encontrado.');
  if ((await query('SELECT 1 FROM leitos WHERE upper(setor_nome)=upper($1) AND upper(numero_leito)=upper($2)', [s.nome_setor, numero])).rowCount) throw new Error('Já existe um leito com esse número neste setor.');
  await query(`INSERT INTO leitos (id_leito,setor_nome,numero_leito,status) VALUES ($1,$2,$3,'Livre')`, [novoId('LEITO'), s.nome_setor, numero]);
  await registrarLog(null, usuarioDe(ctx), 'ADICIONAR_LEITO', `Leito ${numero} criado no setor ${setor}.`);
  return { success: true };
}
async function removerLeito(ctx, idLeito) {
  return transacao(async c => {
    const l = await leitoPorId(c, S(idLeito));
    if (l) {
      exigirSetor(ctx, l.setor_nome);
      if (S(l.status) === 'Ocupado') throw new Error('Não é possível excluir um leito ocupado.');
      await c.query('DELETE FROM leitos WHERE id_leito=$1', [l.id_leito]);
    }
    await registrarLog(c, usuarioDe(ctx), 'REMOVER_LEITO', `Leito ID: ${idLeito} removido.`);
    return { success: true };
  });
}

/* ---------------- setores (NIR/SAME) ---------------- */
async function criarSetor(ctx, dados) {
  exigirAdministrativo(ctx);
  const nome = S(dados && dados.nome);
  if (!nome) throw new Error('Informe o nome do setor.');
  const idSetor = nome.toUpperCase().replace(/\s+/g, '_');
  const qtd = Math.max(0, Math.min(200, Number(dados.leitosAtivos != null ? dados.leitosAtivos : dados.leitosIniciais) || 0));
  return transacao(async c => {
    if ((await c.query('SELECT 1 FROM setores WHERE upper(nome_setor)=upper($1)', [nome])).rowCount) throw new Error('Já existe um setor com esse nome.');
    await c.query('INSERT INTO setores (id_setor,nome_setor,tipo,capacidade_inicial) VALUES ($1,$2,$3,$4)', [idSetor, nome, dados.tipo || 'Internação', qtd]);
    for (let n = 1; n <= qtd; n++) await c.query(`INSERT INTO leitos (id_leito,setor_nome,numero_leito,status) VALUES ($1,$2,$3,'Livre')`, [novoId('LEITO'), nome, 'Leito ' + String(n).padStart(2, '0')]);
    await registrarLog(c, usuarioDe(ctx), 'CRIAR_SETOR', `Setor ${nome} criado com ${qtd} leito(s).`);
    return { success: true, idSetor, nome };
  });
}
async function removerSetor(ctx, nome) {
  exigirAdministrativo(ctx);
  const n = S(nome);
  if ((await query('SELECT 1 FROM leitos WHERE upper(setor_nome)=upper($1) LIMIT 1', [n])).rowCount) throw new Error('Este setor ainda possui leitos cadastrados. Remova os leitos antes de excluir o setor.');
  try {
    const r = await query('DELETE FROM setores WHERE upper(nome_setor)=upper($1)', [n]);
    if (!r.rowCount) throw new Error('Setor não encontrado.');
  } catch (e) {
    if (e.code === '23503') throw new Error('Este setor possui histórico de internações e não pode ser excluído.');
    throw e;
  }
  await registrarLog(null, usuarioDe(ctx), 'REMOVER_SETOR', `Setor ${nome} removido.`);
  return { success: true };
}
async function obterSetores(ctx) { return criarContexto().setores(); }

/* ---------------- consultas de apoio à transferência ---------------- */
async function getLeitosDisponiveisSetor(ctx, setor) {
  const n = S(setor); if (!n) throw new Error('Setor de destino não informado.');
  return (await criarContexto().leitos(n)).filter(l => upper(l.Status) === 'LIVRE').map(l => ({ ID_Leito: l.ID_Leito, Numero_Leito: l.Numero_Leito, Status: l.Status }));
}
async function obterInfoLeitosSetorDestino(ctx, setor, tipoPaciente) {
  const n = S(setor); if (!n) throw new Error('Setor de destino não informado.');
  const tipo = upper(tipoPaciente) === 'MÃE' ? 'MAE' : upper(tipoPaciente);
  const ls = await criarContexto().leitos(n);
  const livres = ls.filter(l => upper(l.Status) === 'LIVRE').map(l => ({ ID_Leito: l.ID_Leito, Numero_Leito: l.Numero_Leito, Status: l.Status, complemento: false }));
  const complementares = ehSetorAlcon(n) && ['MAE', 'RN'].includes(tipo)
    ? ls.filter(l => upper(l.Status) === 'OCUPADO' && (tipo === 'MAE' ? !S(l.ID_Paciente_Mae) : !S(l.ID_Paciente_RN)))
        .map(l => ({ ID_Leito: l.ID_Leito, Numero_Leito: l.Numero_Leito, Status: l.Status, complemento: true })) : [];
  return { totalLeitos: ls.length, livres, complementares };
}

module.exports = { registrarInternacao, admitirVagaZeroUEN, registrarMovimentacao, registrarMovimentacaoAtualizarPainel, trocarLeito, editarInternacao,
  alterarStatusExameExterno, alterarStatusLeito, concluirHigienizacao, marcarHigienizacao, adicionarLeito, removerLeito, criarSetor, removerSetor, obterSetores,
  getLeitosDisponiveisSetor, obterInfoLeitosSetorDestino };
