const { SETOR_UEN, ehSetorAlcon, ehSetorNeonatal, normalizarParto, classificarMovimentoInterno, classificarProcedenciaInterna } = require('./regras');
const U = require('./util');
const { formatarDataStr, formatarDataHoraStr, paraData, dentroDoMes, diasNoPeriodo, chaveDia } = U;

/* Núcleo de cálculo dos indicadores — portado fielmente do Natus original (Apps Script).
   As regras (censo às 24h, UEN, ALCON/binômio, mortalidade etc.) não foram alteradas. */


function mapearSaidasPorInternacao(movsSetor) {
  const mapa = {};
  movsSetor.forEach(m => {
    const tipo = String(m.Tipo_Movimento).trim();
    if (tipo !== 'Alta' && tipo !== 'Obito' && tipo !== 'Evasao' && tipo !== 'Transferencia') return;
    const dataSaida = paraData(m.Data_Hora_Saida);
    if (!dataSaida) return;
    const chave = String(m.ID_Internacao);
    const atual = mapa[chave];
    if (!atual || dataSaida < atual) mapa[chave] = dataSaida;
  });
  return mapa;
}

function contarPacientesNoDia(internacoesSetor, mapaSaidas, diaKey) {
  let count = 0;
  
  internacoesSetor.forEach(i => {
    // Pega o número YYYYMMDD exato da entrada
    const entradaKey = chaveDia(i.Data_Hora_Entrada);
    if (!entradaKey) return;
    
    // 1. Se a entrada foi DEPOIS do dia do censo, não conta
    if (entradaKey > diaKey) return;
    
    // 2. Se houve saída
    const saidaVal = mapaSaidas[String(i.ID_Internacao)];
    if (saidaVal) {
      const saidaKey = chaveDia(saidaVal);
      // Se a saída foi NO MESMO DIA ou ANTES do dia do censo, não conta
      if (saidaKey <= diaKey) return;
    }
    
    count++;
  });
  
  return count;
}

/* Regra de contagem exclusiva da UEN (leitos-extra "vaga zero"): diferente do censo tradicional
   (contarPacientesNoDia, que ignora quem entrou E saiu no mesmo dia), aqui conta-se qualquer RN
   que esteve internado em algum momento do dia - inclusive quem entrou e saiu no mesmo dia
   (permanência <24h ainda soma 1 paciente-dia no fechamento). Isso é necessário porque a fórmula
   tradicional de leitos-dia não se aplica quando o número de leitos muda todo dia. */
function contarPacientesDiaUEN(internacoesSetor, mapaSaidas, diaKey) {
  let count = 0;

  internacoesSetor.forEach(i => {
    const entradaKey = chaveDia(i.Data_Hora_Entrada);
    if (!entradaKey || entradaKey > diaKey) return;

    const saidaVal = mapaSaidas[String(i.ID_Internacao)];
    if (saidaVal) {
      const saidaKey = chaveDia(saidaVal);
      // Só exclui se a saída ocorreu ANTES do dia do censo. Saída NO PRÓPRIO dia do censo
      // ainda conta (diferente da regra tradicional), pois o RN esteve na UEN durante o dia.
      if (saidaKey < diaKey) return;
    }

    count++;
  });

  return count;
}

/* ALCON: o censo de ocupação é físico, por leito, e não por paciente.
   Quando Mãe + RN ocupam simultaneamente o mesmo leito, são 2 internações clínicas,
   mas representam apenas 1 leito ocupado às 24h. Esta função mantém essa distinção
   para que a taxa de ocupação mensal nunca seja inflada pelo binômio. */
function contarLeitosOcupadosNoDia(internacoesSetor, mapaSaidas, diaKey) {
  const leitosOcupados = new Set();

  internacoesSetor.forEach(i => {
    const entradaKey = chaveDia(i.Data_Hora_Entrada);
    if (!entradaKey || entradaKey > diaKey) return;

    const saidaVal = mapaSaidas[String(i.ID_Internacao)];
    if (saidaVal) {
      const saidaKey = chaveDia(saidaVal);
      // Regra do censo às 24h: se saiu no próprio dia, não está ocupando o leito no fechamento.
      if (saidaKey <= diaKey) return;
    }

    const leitoId = String(i.ID_Leito || '').trim();
    if (leitoId) leitosOcupados.add(leitoId);
  });

  return leitosOcupados.size;
}

/* ALCON — binômio Mãe+RN como UM único EPISÓDIO de internação.
   A admissão conjunta (Mãe e RN no mesmo leito) deve contar como UMA internação; a continuidade
   clínica do RN após a alta da Mãe (nova internação para Tratamento Clínico) pertence ao MESMO
   episódio. O vínculo preferencial é o id_binomio; para dados legados sem vínculo, unimos MAE+RN
   que ocuparam o mesmo leito em intervalos de tempo sobrepostos (mesma regra do binômio). */
function episodiosAlcon(internacoesAlcon, mapaSaidas) {
  const lista = internacoesAlcon
    .map(i => ({
      row: i,
      inicio: paraData(i.Data_Hora_Entrada),
      fim: paraData(mapaSaidas[String(i.ID_Internacao)]) || null,
      tipo: String(i.Tipo_Paciente || '').trim().toUpperCase(),
      leito: String(i.ID_Leito || '').trim(),
      bin: String(i.ID_Binomio || '').trim()
    }))
    .filter(x => x.inicio)
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  const sobrepoe = (a, b) => {
    const aFim = a.fim ? a.fim.getTime() : Infinity;
    const bFim = b.fim ? b.fim.getTime() : Infinity;
    return a.inicio.getTime() <= bFim && b.inicio.getTime() <= aFim;
  };

  const usado = new Set();
  const grupos = [];
  lista.forEach((x, idx) => {
    if (usado.has(idx)) return;
    usado.add(idx);
    const grupo = [x];
    if (x.bin) {
      lista.forEach((y, jdx) => { if (jdx !== idx && !usado.has(jdx) && y.bin === x.bin) { usado.add(jdx); grupo.push(y); } });
    } else if (x.leito && (x.tipo === 'MAE' || x.tipo === 'MÃE' || x.tipo === 'RN')) {
      const incompat = x.tipo === 'RN' ? 'MAE' : 'RN';
      const par = lista.findIndex((y, jdx) => jdx !== idx && !usado.has(jdx) && y.leito === x.leito && !y.bin &&
        (y.tipo === incompat || (incompat === 'MAE' && y.tipo === 'MÃE')) && sobrepoe(x, y));
      if (par >= 0) { usado.add(par); grupo.push(lista[par]); }
    }
    grupos.push(grupo);
  });

  // Representante: prefere a Mãe (carrega parto/procedência obstétrica); senão o 1º registro.
  return grupos.map(g => {
    const mae = g.find(x => x.tipo === 'MAE' || x.tipo === 'MÃE');
    return { representante: (mae || g[0]).row, membros: g.map(x => x.row) };
  });
}


async function calcularIndicadoresSetor(D, setorAtual, mes, ano) {
  const hoje = new Date();
  const mesRef = Number(mes) || (hoje.getMonth() + 1);
  const anoRef = Number(ano) || hoje.getFullYear();

  // Leituras independentes: preserva dados/regras e evita três esperas sequenciais.
  const [leitos, internacoes, movimentacoes] = await Promise.all([
    D.leitos(setorAtual), D.internacoes(setorAtual), D.movimentacoes(setorAtual)
  ]);

  const totalLeitos = leitos.length;
  const ehAlcon = ehSetorAlcon(setorAtual);
  const ehUEN = String(setorAtual).trim().toUpperCase() === SETOR_UEN;

  const idInternacoesSetor = new Set(internacoes.map(i => String(i.ID_Internacao)));
  const movsSetor = movimentacoes.filter(m => idInternacoesSetor.has(String(m.ID_Internacao)));
  const mapaSaidas = mapearSaidasPorInternacao(movsSetor);
  const movsSetorMes = movsSetor.filter(m => dentroDoMes(m.Data_Hora_Saida, mesRef, anoRef));

  // Todas as internações iniciadas no mês (detalhe por paciente).
  const internacoesMes = internacoes.filter(i => dentroDoMes(i.Data_Hora_Entrada, mesRef, anoRef));
  // ALCON: a admissão conjunta Mãe+RN conta como UMA internação (episódio). A lista de admissões
  // usa um representante por episódio; as estatísticas detalhadas seguem com as linhas reais.
  const episodios = ehAlcon ? episodiosAlcon(internacoesMes, mapaSaidas) : null;
  const admissoes = ehAlcon ? episodios.map(e => e.representante) : internacoesMes;
  // Neonatal: a Mãe é excluída das estatísticas específicas de RN (não infla o denominador neonatal).
  const internacoesRn = ehSetorNeonatal(setorAtual)
    ? internacoesMes.filter(i => { const t = String(i.Tipo_Paciente || '').trim().toUpperCase(); return t !== 'MAE' && t !== 'MÃE'; })
    : internacoesMes;

  const rnsInternadosMes = ehAlcon
    ? internacoesMes.filter(i => String(i.Tipo_Paciente || '').trim().toUpperCase() === 'RN' && String(i.RN_Sozinho || '').trim().toUpperCase() === 'SIM').length
    : 0;
  const admissoesInternasMes = admissoes.filter(i => classificarProcedenciaInterna(i.Procedencia)).length;
  const admissoesExternasMes = admissoes.length - admissoesInternasMes;

  // Lido uma única vez aqui (e indexado em mapa) para alimentar a estatística de sexo abaixo
  // sem reconsultar a aba Pacientes a cada internação.
  const mapaPacientesPorId = {};
  (await D.pacientes(setorAtual)).forEach(p => { mapaPacientesPorId[String(p.ID_Paciente)] = p; });

  const altasMovMes = movsSetorMes.filter(m => String(m.Tipo_Movimento).trim() === 'Alta');
  const altasMes = altasMovMes.length;
  const obitosMes = movsSetorMes.filter(m => String(m.Tipo_Movimento).trim() === 'Obito').length;
  const evasoesMes = movsSetorMes.filter(m => String(m.Tipo_Movimento).trim() === 'Evasao').length;
  const transferenciasMesLista = movsSetorMes.filter(m => String(m.Tipo_Movimento).trim() === 'Transferencia');
  const transfMes = transferenciasMesLista.length;
  const altasDomiciliar = altasMovMes.filter(m => {
    const d = String(m.Destino || '').trim().toUpperCase();
    return d === 'DOMICILIAR' || d === 'DOMICILIAR (CAPITAL)' || d === 'CASA';
  }).length;
  const altasMunicipio = altasMovMes.filter(m => String(m.Destino || '').trim().toUpperCase().indexOf('OUTRO MUNICÍPIO') === 0).length;
  const transferenciasInternasMes = transferenciasMesLista.filter(m => classificarMovimentoInterno(m.Destino)).length;
  const transferenciasExternasMes = transfMes - transferenciasInternasMes;
  const totalSaidasMes = altasMes + obitosMes + evasoesMes + transfMes;

  const dias = diasNoPeriodo(mesRef, anoRef);
  const porDiaPacientes = [];
  const porDiaOcupacao = [];
  let totalPacienteDia = 0;
  let totalLeitoDia = 0;

  for (let d = 1; d <= dias; d++) {
    const mm = String(mesRef).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const diaKey = Number(`${anoRef}${mm}${dd}`);

    // UEN: não existe quantidade fixa de leitos (cada leito é criado/extinto sob demanda), então
    // a fórmula tradicional de censo à meia-noite (contarPacientesNoDia, que ignora quem entrou
    // E saiu no mesmo dia) apagaria o trabalho da equipe em dias de alta rotatividade.
    // contarPacientesDiaUEN conta qualquer RN que passou pela UEN em algum momento do dia,
    // inclusive permanência <24h (entrada e saída no mesmo dia contam como 1 paciente-dia).
    const pacientesDia = ehUEN
      ? contarPacientesDiaUEN(internacoes, mapaSaidas, diaKey)
      : contarPacientesNoDia(internacoes, mapaSaidas, diaKey);

    // Para ALCON, a ocupação mensal é baseada no número de leitos físicos ocupados às 24h.
    // Assim, Mãe + RN no mesmo leito = 1 leito ocupado, mesmo que existam 2 internações ativas.
    const ocupacaoLeitosDia = ehAlcon
      ? contarLeitosOcupadosNoDia(internacoes, mapaSaidas, diaKey)
      : pacientesDia;

    totalPacienteDia += pacientesDia;
    totalLeitoDia += ocupacaoLeitosDia;
    porDiaPacientes.push({ dia: d, pacientes: pacientesDia });
    porDiaOcupacao.push({ dia: d, ocupacao: ocupacaoLeitosDia });
  }

 // Mantém a variável para não quebrar outros módulos do sistema
  const diasComCenso = porDiaOcupacao.filter(p => p.ocupacao > 0).length;

  // UEN: a "capacidade instalada" do mês é a soma dia a dia da capacidade instalada de cada dia
  // (nº de leitos extras ativos naquele dia) - não totalLeitos x dias, que não se aplica quando
  // o número de leitos muda todo dia. Ex.: 3 RNs em 01/10 + 5 em 02/10 = capacidade acumulada 8.
  const capacidadeAcumulada = ehUEN ? totalPacienteDia : (totalLeitos * dias);

  // Para os demais setores, a taxa de ocupação mensal segue a fórmula tradicional. Para a UEN,
  // esse percentual não é aplicável (não há denominador fixo de leitos-dia) - a Dashboard da UEN
  // usa capacidadeAcumulada/mediaPacientesDia diretamente em vez desta taxa.
  const numeradorOcupacaoMensal = ehAlcon ? totalLeitoDia : totalPacienteDia;
  const taxaOcupacaoMensal = (!ehUEN && capacidadeAcumulada > 0)
    ? ((numeradorOcupacaoMensal / capacidadeAcumulada) * 100).toFixed(2)
    : "0.00";

  const mediaPacientesDia = dias > 0
    ? (totalPacienteDia / dias).toFixed(1)
    : "0.0";

  const mediaPermanencia = totalSaidasMes > 0
    ? (totalPacienteDia / totalSaidasMes).toFixed(1)
    : "0.0";

  // UEN: transferências internas cujo destino é uma das UTINs representam estabilização e
  // encaminhamento bem-sucedidos pela equipe da UEN - não um desfecho negativo.
  const transferenciasParaUTINMes = ehUEN
    ? transferenciasMesLista.filter(m => String(m.Destino || '').trim().toUpperCase().indexOf('UTIN') === 0).length
    : 0;

  // Taxa de mortalidade "justa" da UEN: óbitos frente ao total de casos graves que a equipe
  // efetivamente desfechou (óbitos + transferências para a UTIN), em vez de óbitos / total de
  // saídas (que inclui altas e transferências não relacionadas ao desfecho clínico de gravidade
  // e penalizaria injustamente uma equipe de alta rotatividade e resolutividade).
  const taxaMortalidade = ehUEN
    ? ((obitosMes + transferenciasParaUTINMes) > 0
        ? ((obitosMes / (obitosMes + transferenciasParaUTINMes)) * 100).toFixed(1)
        : "0.0")
    : (totalSaidasMes > 0 ? ((obitosMes / totalSaidasMes) * 100).toFixed(1) : "0.0");

  const taxaGiro = totalLeitos > 0
    ? (totalSaidasMes / totalLeitos).toFixed(2)
    : "0.00";

  // Faixa de Peso: a UCINCA usa categorias mais granuladas (V15) na Nova Internação
  // (1250-1499g / 1500-1799g / 1800-2000g / >2000g), diferente da faixa padrão dos demais
  // setores (<1500g / 1500-2499g / ≥2500g). As chaves ficam com o mesmo padrão (usadas também
  // por obterEstatisticasDashboardGeral, que soma essa estatística dinamicamente por chave), e
  // o Dashboard por setor renderiza o card "Faixa de Peso" a partir dela dinamicamente,
  // aplicando o rótulo (legenda) correspondente a cada chave via rotuloFaixaPeso().
  const ehUCINCAPeso = String(setorAtual).trim().toUpperCase() === 'UCINCA';
  const estatisticas = {
    // Neonatal: o peso ao nascer é atributo do RN — a Mãe (internacoesRn) fica de fora.
    peso: ehUCINCAPeso ? {
      '1250-1499': internacoesRn.filter(i => String(i.Peso_Nascer).includes('1250-1499')).length,
      '1500-1799': internacoesRn.filter(i => String(i.Peso_Nascer).includes('1500-1799')).length,
      '1800-2000': internacoesRn.filter(i => String(i.Peso_Nascer).includes('1800-2000')).length,
      '>2000': internacoesRn.filter(i => String(i.Peso_Nascer).includes('>2000')).length
    } : {
      menor1500: internacoesRn.filter(i => String(i.Peso_Nascer).includes('<1500')).length,
      de1500a2499: internacoesRn.filter(i => String(i.Peso_Nascer).includes('1500-2499')).length,
      maior2500: internacoesRn.filter(i => String(i.Peso_Nascer).includes('≥2500')).length
    },
    // Partos: usa as admissões (episódios). Em ALCON, o representante do binômio é a Mãe.
    parto: {
      normal: admissoes.filter(i => normalizarParto(i.Tipo_Parto) === 'Normal').length,
      cesarea: admissoes.filter(i => normalizarParto(i.Tipo_Parto) === 'Cesárea').length
    },
    // Otimização: antes buscava e desserializava a aba Pacientes inteira do cache uma vez
    // POR internação (2x, uma para cada sexo) - O(N) buscas de O(M) registros. Agora a aba é
    // lida uma única vez e indexada em um mapa (O(1) por consulta). Em setor neonatal a Mãe é
    // excluída (internacoesRn) para não inflar o sexo feminino com as puérperas.
    sexo: (() => {
      let masculino = 0, feminino = 0;
      internacoesRn.forEach(i => {
        const p = mapaPacientesPorId[String(i.ID_Paciente)];
        if (!p) return;
        if (String(p.Sexo) === 'M') masculino++;
        else if (String(p.Sexo) === 'F') feminino++;
      });
      return { masculino, feminino };
    })(),
    procedencia: admissoes.reduce((acc, i) => {
      const key = i.Procedencia || 'NÃO INFORMADO';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  };

  return {
    setorAtual, mesRef, anoRef, totalLeitos, ehUEN, transferenciasParaUTINMes, ehAlcon, rnsInternadosMes,
    internacoesMes: admissoes.length,
    admissoesInternasMes, admissoesExternasMes,
    altasMes, altasDomiciliar, altasMunicipio, obitosMes, evasoesMes, transfMes, transferenciasInternasMes, transferenciasExternasMes, totalSaidasMes,
    totalPacienteDia, totalLeitoDia, capacidadeAcumulada, dias, diasComCenso,
    taxaOcupacaoMensal, mediaPermanencia, taxaGiro, taxaMortalidade, mediaPacientesDia,
    estatisticas, porDiaPacientes, porDiaOcupacao
  };
}


async function calcularRNsAlconNoMes(D, setor, mes, ano) {
  const ints = await D.internacoes(setor);
  return ints.filter(i => dentroDoMes(i.Data_Hora_Entrada, mes, ano) && String(i.Tipo_Paciente || '').trim().toUpperCase() === 'RN' && String(i.RN_Sozinho || '').trim().toUpperCase() === 'SIM').length;
}

function obterInternacoesHojeAlcon(internacoesSetor, movimentacoesSetor, strHoje) {
  const mapaSaida = {};
  movimentacoesSetor.forEach(m => {
    const id = String(m.ID_Internacao || '').trim();
    if (!id) return;
    const dt = m.Data_Hora_Saida instanceof Date ? m.Data_Hora_Saida : new Date(m.Data_Hora_Saida);
    if (isNaN(dt.getTime())) return;
    if (!mapaSaida[id] || dt.getTime() < mapaSaida[id].getTime()) mapaSaida[id] = dt;
  });

  const candidatas = internacoesSetor
    .filter(i => formatarDataStr(i.Data_Hora_Entrada) === strHoje)
    .map(i => ({
      int: i,
      inicio: i.Data_Hora_Entrada instanceof Date ? i.Data_Hora_Entrada : new Date(i.Data_Hora_Entrada),
      fim: mapaSaida[String(i.ID_Internacao || '').trim()] || null,
      tipo: String(i.Tipo_Paciente || '').trim().toUpperCase(),
      leito: String(i.ID_Leito || '').trim()
    }))
    .filter(x => !isNaN(x.inicio.getTime()))
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  const contadas = [];
  candidatas.forEach(c => {
    const sobrepoeBinomio = contadas.some(prev => {
      if (!c.leito || !prev.leito || c.leito !== prev.leito) return false;
      if (!((c.tipo === 'MAE' && prev.tipo === 'RN') || (c.tipo === 'RN' && prev.tipo === 'MAE'))) return false;
      // Intervalos fechados-abertos: se a internação anterior terminou antes ou no momento
      // da nova admissão, não há binômio simultâneo e as duas contam separadamente.
      if (prev.fim && prev.fim.getTime() <= c.inicio.getTime()) return false;
      if (c.fim && c.fim.getTime() <= prev.inicio.getTime()) return false;
      return true;
    });
    if (!sobrepoeBinomio) contadas.push(c);
  });

  return contadas.map(x => x.int);
}

// Mantém a resposta completa para os consumidores existentes. O painel de leitos

async function obterEstatisticasDashboard(D, setorAtual, mes, ano) {
  setorAtual = setorAtual || 'UTIN 1';
  const ind = await calcularIndicadoresSetor(D, setorAtual, mes, ano);

  const internacoesSetor = await D.internacoes(setorAtual);
  const movimentacoes = await D.movimentacoes(setorAtual);
  const leitos = await D.leitos(setorAtual);
  const idInternacoesSetor = new Set(internacoesSetor.map(i => String(i.ID_Internacao)));
  const movsSetorMes = movimentacoes.filter(m => idInternacoesSetor.has(String(m.ID_Internacao)) && dentroDoMes(m.Data_Hora_Saida, ind.mesRef, ind.anoRef));

  const mapaInternacaoPorId = {};
  internacoesSetor.forEach(i => { mapaInternacaoPorId[String(i.ID_Internacao)] = i; });

  const faixasPermanencia = { '0-5 dias': 0, '6-10 dias': 0, '11-20 dias': 0, '20+ dias': 0 };
  const girosPorLeito = {};

  movsSetorMes.forEach(m => {
    const internacao = mapaInternacaoPorId[String(m.ID_Internacao)];
    if (!internacao) return;

    const entrada = paraData(internacao.Data_Hora_Entrada);
    const saida = paraData(m.Data_Hora_Saida);
    if (entrada && saida) {
      const diasPermanencia = Math.max(1, Math.round((saida.getTime() - entrada.getTime()) / 86400000));
      if (diasPermanencia <= 5) faixasPermanencia['0-5 dias']++;
      else if (diasPermanencia <= 10) faixasPermanencia['6-10 dias']++;
      else if (diasPermanencia <= 20) faixasPermanencia['11-20 dias']++;
      else faixasPermanencia['20+ dias']++;
    }

    const leito = leitos.find(l => String(l.ID_Leito) === String(internacao.ID_Leito));
    const numeroLeito = leito ? leito.Numero_Leito : (internacao.Numero_Leito_Hist || internacao.ID_Leito);
    girosPorLeito[numeroLeito] = (girosPorLeito[numeroLeito] || 0) + 1;
  });

  const denominadorLetalidade = ind.altasMes + ind.obitosMes;
  const taxaLetalidade = denominadorLetalidade > 0
    ? ((ind.obitosMes / denominadorLetalidade) * 100).toFixed(1)
    : "0.0";

  // Estatística exclusiva do setor UCINCA: classifica os RNs de Alta por adequação de peso.
  // Alta Domiciliar (Capital): peso mínimo de referência 1.600g.
  // Alta Outro Município: peso mínimo de referência 2.500g.
  // "Alta tardia" = saiu muito além do peso mínimo (mais de 500g acima do limiar de referência).
  let altasPesoUcinca = null;
  if (String(setorAtual).trim().toUpperCase() === 'UCINCA') {
    const LIMIAR_DOMICILIAR_CAPITAL = 1600;
    const LIMIAR_OUTRO_MUNICIPIO = 2500;
    const MARGEM_ALTA_TARDIA = 500;

    const vazio = () => ({ abaixoPesoIdeal: 0, pesoIdeal: 0, altaTardia: 0, naoInformado: 0 });
    altasPesoUcinca = {
      domiciliarCapital: Object.assign({ limiarMinimo: LIMIAR_DOMICILIAR_CAPITAL }, vazio()),
      outroMunicipio: Object.assign({ limiarMinimo: LIMIAR_OUTRO_MUNICIPIO }, vazio()),
      total: vazio(),
      margemAltaTardia: MARGEM_ALTA_TARDIA
    };

    movsSetorMes
      .filter(m => String(m.Tipo_Movimento).trim() === 'Alta')
      .forEach(m => {
        const destinoAlta = String(m.Destino || '').trim().toUpperCase();
        const grupo = destinoAlta === 'DOMICILIAR (CAPITAL)' ? 'domiciliarCapital'
          : (destinoAlta.indexOf('OUTRO MUNICÍPIO') === 0 ? 'outroMunicipio' : null);
        if (!grupo) return;

        const pesoStr = String(m.Peso_Saida_Gramas || '').trim();
        const peso = pesoStr !== '' ? Number(pesoStr) : NaN;
        const limiar = altasPesoUcinca[grupo].limiarMinimo;

        let categoria;
        if (isNaN(peso)) categoria = 'naoInformado';
        else if (peso < limiar) categoria = 'abaixoPesoIdeal';
        else if (peso <= limiar + MARGEM_ALTA_TARDIA) categoria = 'pesoIdeal';
        else categoria = 'altaTardia';

        altasPesoUcinca[grupo][categoria]++;
        altasPesoUcinca.total[categoria]++;
      });
  }

  return {
    ehUEN: ind.ehUEN,
    kpis: {
      taxaOcupacaoMensal: ind.taxaOcupacaoMensal,
      capacidadeInstaladaAcumulada: ind.capacidadeAcumulada,
      mediaPacientesDia: ind.mediaPacientesDia,
      taxaMortalidade: ind.taxaMortalidade,
      obitosMes: ind.obitosMes,
      transferenciasParaUTINMes: ind.transferenciasParaUTINMes,
      admissoesMes: ind.internacoesMes,
      admissoesInternasMes: ind.admissoesInternasMes,
      admissoesExternasMes: ind.admissoesExternasMes,
      altasMes: ind.altasMes,
      altasDomiciliar: ind.altasDomiciliar,
      altasMunicipio: ind.altasMunicipio,
      evasoesMes: ind.evasoesMes,
      transfMes: ind.transfMes,
      rnsInternadosMes: ehSetorAlcon(setorAtual) ? ind.rnsInternadosMes : 0,
      transferenciasInternasMes: ind.transferenciasInternasMes,
      transferenciasExternasMes: ind.transferenciasExternasMes,
      peso: ind.estatisticas.peso
    },
    porDia: (ind.porDiaOcupacao || ind.porDiaPacientes.map(p => ({ dia: p.dia, ocupacao: p.pacientes }))),
    estatisticas: {
      procedencia: ind.estatisticas.procedencia,
      faixasPermanencia,
      girosPorLeito,
      altasPesoUcinca
    }
  };
}


async function calcularIndicadoresGeral(D, mes, ano) {
  const nomesSetores = (await D.setores()).map(s => s.Nome_Setor);
  const porSetor = [];
  for (const s of nomesSetores) porSetor.push(await calcularIndicadoresSetor(D, s, mes, ano));

  const dias = porSetor.length ? porSetor[0].dias : diasNoPeriodo(mes, ano);
  const porDiaAgregado = [];
  for (let d = 1; d <= dias; d++) {
    let soma = 0;
    porSetor.forEach(ind => {
      const serie = ind.porDiaOcupacao || ind.porDiaPacientes.map(p => ({ dia: p.dia, ocupacao: p.pacientes }));
      soma += (serie[d - 1] && serie[d - 1].ocupacao) || 0;
    });
    porDiaAgregado.push({ dia: d, pacientes: soma });
  }

  let totalLeitos = 0, internacoesMes = 0, admissoesInternasMes = 0, admissoesExternasMes = 0;
  let altasMes = 0, altasDomiciliar = 0, altasMunicipio = 0, obitosMes = 0, transfMes = 0;
  let transferenciasInternasMes = 0, transferenciasExternasMes = 0, totalSaidasMes = 0;
  let totalPacienteDia = 0, totalLeitoDia = 0, capacidadeAcumulada = 0;

  porSetor.forEach(ind => {
    totalLeitos += ind.totalLeitos;
    internacoesMes += ind.internacoesMes;
    admissoesInternasMes += ind.admissoesInternasMes;
    admissoesExternasMes += ind.admissoesExternasMes;
    altasMes += ind.altasMes;
    altasDomiciliar += ind.altasDomiciliar;
    altasMunicipio += ind.altasMunicipio;
    obitosMes += ind.obitosMes;
    transfMes += ind.transfMes;
    transferenciasInternasMes += ind.transferenciasInternasMes;
    transferenciasExternasMes += ind.transferenciasExternasMes;
    totalSaidasMes += ind.totalSaidasMes;
    totalPacienteDia += ind.totalPacienteDia;
    totalLeitoDia += (ind.totalLeitoDia != null ? ind.totalLeitoDia : ind.totalPacienteDia);
    capacidadeAcumulada += ind.capacidadeAcumulada;
  });

  const picoDiario = porDiaAgregado.length ? Math.max(...porDiaAgregado.map(p => p.pacientes)) : 0;
  const taxaOcupacaoMensal = capacidadeAcumulada > 0 ? ((totalLeitoDia / capacidadeAcumulada) * 100).toFixed(2) : "0.00";
  const mediaPacientesDia = dias > 0 ? (totalPacienteDia / dias).toFixed(1) : "0.0";
  const mediaPermanencia = totalSaidasMes > 0 ? (totalPacienteDia / totalSaidasMes).toFixed(1) : "0.0";
  const taxaMortalidade = totalSaidasMes > 0 ? ((obitosMes / totalSaidasMes) * 100).toFixed(1) : "0.0";
  const taxaGiro = totalLeitos > 0 ? (totalSaidasMes / totalLeitos).toFixed(2) : "0.00";

  return {
    setorAtual: 'Todos os Setores', mesRef: mes, anoRef: ano, totalLeitos, ehUEN: false,
    internacoesMes, admissoesInternasMes, admissoesExternasMes,
    altasMes, altasDomiciliar, altasMunicipio, obitosMes, transfMes,
    transferenciasInternasMes, transferenciasExternasMes, totalSaidasMes,
    totalPacienteDia, capacidadeAcumulada, dias, picoDiario,
    taxaOcupacaoMensal, mediaPermanencia, taxaGiro, taxaMortalidade, mediaPacientesDia,
    porDiaPacientes: porDiaAgregado, porSetor
  };
}

async function obterEstatisticasDashboardGeral(D, setorFiltro, mes, ano) {
  const ehTodos = !setorFiltro || String(setorFiltro).trim() === '' || String(setorFiltro).trim().toUpperCase().indexOf('TODOS') === 0;
  if (!ehTodos) return obterEstatisticasDashboard(D, setorFiltro, mes, ano);

  const ind = await calcularIndicadoresGeral(D, mes, ano);

  const faixasPermanencia = { '0-5 dias': 0, '6-10 dias': 0, '11-20 dias': 0, '20+ dias': 0 };
  const procedencia = {};
  const peso = {};

  ind.porSetor.forEach(indSetor => {
    Object.keys(indSetor.estatisticas.procedencia || {}).forEach(k => {
      procedencia[k] = (procedencia[k] || 0) + indSetor.estatisticas.procedencia[k];
    });
    Object.keys(indSetor.estatisticas.peso || {}).forEach(k => {
      peso[k] = (peso[k] || 0) + indSetor.estatisticas.peso[k];
    });
  });

  // Faixas de permanência exigem os dados de movimentação por setor (o mesmo cálculo que
  // obterEstatisticasDashboard faz por dentro) - aqui reaproveitamos chamando-a uma vez por
  // setor e somando essa estatística (o resto de cada chamada é descartado).
  // Giro: em "Todos os Setores" o gráfico por leito individual ficaria extenso demais (dezenas
  // de leitos), então aqui ele é agregado por SETOR (soma de todas as saídas dos leitos daquele
  // setor no mês) - diferente da visão por setor específico, que continua detalhando por leito.
  const girosPorLeito = {};
  for (const s of (await D.setores()).map(x => x.Nome_Setor)) {
    const est = await obterEstatisticasDashboard(D, s, mes, ano);
    Object.keys(est.estatisticas.faixasPermanencia || {}).forEach(k => {
      faixasPermanencia[k] += est.estatisticas.faixasPermanencia[k];
    });
    const totalGirosSetor = Object.values(est.estatisticas.girosPorLeito || {}).reduce((soma, v) => soma + v, 0);
    if (totalGirosSetor > 0) girosPorLeito[s] = totalGirosSetor;
  }

  return {
    ehUEN: false,
    ehGeral: true,
    kpis: {
      taxaOcupacaoMensal: ind.taxaOcupacaoMensal,
      capacidadeInstaladaAcumulada: ind.capacidadeAcumulada,
      mediaPacientesDia: ind.mediaPacientesDia,
      taxaMortalidade: ind.taxaMortalidade,
      obitosMes: ind.obitosMes,
      transferenciasParaUTINMes: 0,
      admissoesMes: ind.internacoesMes,
      admissoesInternasMes: ind.admissoesInternasMes,
      admissoesExternasMes: ind.admissoesExternasMes,
      altasMes: ind.altasMes,
      altasDomiciliar: ind.altasDomiciliar,
      altasMunicipio: ind.altasMunicipio,
      transfMes: ind.transfMes,
      transferenciasInternasMes: ind.transferenciasInternasMes,
      transferenciasExternasMes: ind.transferenciasExternasMes,
      peso,
      picoDiario: ind.picoDiario,
      totalLeitos: ind.totalLeitos
    },
    porDia: (ind.porDiaOcupacao || ind.porDiaPacientes.map(p => ({ dia: p.dia, ocupacao: p.pacientes }))),
    porSetor: ind.porSetor.map(s => ({
      setor: s.setorAtual, taxaOcupacaoMensal: s.taxaOcupacaoMensal, totalLeitos: s.totalLeitos,
      admissoes: s.internacoesMes, altas: s.altasMes, obitos: s.obitosMes, ehUEN: s.ehUEN
    })),
    estatisticas: { procedencia, faixasPermanencia, girosPorLeito, altasPesoUcinca: null }
  };
}


/* Indicadores de um PERÍODO ARBITRÁRIO (não necessariamente um mês fechado) — usado pelo BI.
   Corrige a divergência em que filtros de período parcial contavam meses inteiros: aqui cada
   métrica é recortada exatamente em [dataInicial, dataFinal]. Reaproveita as mesmas regras de
   censo (ALCON por leito, UEN por paciente-dia, binômio Mãe+RN = 1 internação). */
async function calcularIndicadoresPeriodo(D, setorAtual, dataInicial, dataFinal) {
  const [leitos, internacoes, movimentacoes] = await Promise.all([
    D.leitos(setorAtual), D.internacoes(setorAtual), D.movimentacoes(setorAtual)
  ]);
  const [ai, mi, di] = String(dataInicial).split('-').map(Number);
  const [af, mf, df] = String(dataFinal).split('-').map(Number);
  const dtIni = new Date(ai, mi - 1, di, 12, 0, 0);
  const dtFim = new Date(af, mf - 1, df, 12, 0, 0);
  const dias = Math.max(1, Math.round((dtFim - dtIni) / 86400000) + 1);
  const kIni = chaveDia(dtIni), kFim = chaveDia(dtFim);
  const noPeriodo = v => { const k = chaveDia(v); return k > 0 && k >= kIni && k <= kFim; };

  const ehAlcon = ehSetorAlcon(setorAtual);
  const ehUEN = String(setorAtual).trim().toUpperCase() === SETOR_UEN;
  const idInt = new Set(internacoes.map(i => String(i.ID_Internacao)));
  const movs = movimentacoes.filter(m => idInt.has(String(m.ID_Internacao)));
  const mapaSaidas = mapearSaidasPorInternacao(movs);

  const intPeriodo = internacoes.filter(i => noPeriodo(i.Data_Hora_Entrada));
  const episodios = ehAlcon ? episodiosAlcon(intPeriodo, mapaSaidas) : null;
  const admissoes = ehAlcon ? episodios.map(e => e.representante) : intPeriodo;
  const internacoesRn = ehSetorNeonatal(setorAtual)
    ? intPeriodo.filter(i => { const t = String(i.Tipo_Paciente || '').trim().toUpperCase(); return t !== 'MAE' && t !== 'MÃE'; })
    : intPeriodo;

  const movsPeriodo = movs.filter(m => noPeriodo(m.Data_Hora_Saida));
  const doTipo = t => movsPeriodo.filter(m => String(m.Tipo_Movimento).trim() === t).length;
  const altasMes = doTipo('Alta'), obitosMes = doTipo('Obito'), evasoesMes = doTipo('Evasao'), transfMes = doTipo('Transferencia');
  const totalSaidasMes = altasMes + obitosMes + evasoesMes + transfMes;

  const mapaPacientesPorId = {};
  (await D.pacientes(setorAtual)).forEach(p => { mapaPacientesPorId[String(p.ID_Paciente)] = p; });

  let totalPacienteDia = 0, totalLeitoDia = 0, picoDiario = 0;
  const porDia = [];
  for (let k = 0; k < dias; k++) {
    const dt = new Date(ai, mi - 1, di + k, 12, 0, 0);
    const diaKey = chaveDia(dt);
    const pacientesDia = ehUEN ? contarPacientesDiaUEN(internacoes, mapaSaidas, diaKey) : contarPacientesNoDia(internacoes, mapaSaidas, diaKey);
    const ocupacaoLeitosDia = ehAlcon ? contarLeitosOcupadosNoDia(internacoes, mapaSaidas, diaKey) : pacientesDia;
    totalPacienteDia += pacientesDia;
    totalLeitoDia += ocupacaoLeitosDia;
    if (pacientesDia > picoDiario) picoDiario = pacientesDia;
    porDia.push({ dia: k + 1, data: formatarDataStr(dt), pacientes: pacientesDia, ocupacao: ocupacaoLeitosDia });
  }

  const totalLeitos = leitos.length;
  const capacidadeAcumulada = ehUEN ? totalPacienteDia : (totalLeitos * dias);
  const numerador = ehAlcon ? totalLeitoDia : totalPacienteDia;
  const taxaOcupacaoPeriodo = (!ehUEN && capacidadeAcumulada > 0) ? ((numerador / capacidadeAcumulada) * 100) : 0;
  const mediaPermanencia = totalSaidasMes > 0 ? (totalPacienteDia / totalSaidasMes) : 0;
  const mediaPacientesDia = dias > 0 ? (totalPacienteDia / dias) : 0;

  const partos = { normal: 0, cesarea: 0, forceps: 0, outros: 0 };
  admissoes.forEach(i => {
    const cat = normalizarParto(i.Tipo_Parto);
    if (cat === 'Normal') partos.normal++;
    else if (cat === 'Cesárea') partos.cesarea++;
    else if (cat === 'Fórceps') partos.forceps++;
    else if (cat) partos.outros++;
  });
  const peso = { menor1500: 0, de1500a2499: 0, maior2500: 0 };
  internacoesRn.forEach(i => {
    const p = String(i.Peso_Nascer);
    if (p.includes('<1500')) peso.menor1500++;
    if (p.includes('1500-2499')) peso.de1500a2499++;
    if (p.includes('≥2500')) peso.maior2500++;
  });
  const rnsInternados = internacoesRn.filter(i => String(i.Tipo_Paciente || '').trim().toUpperCase() === 'RN').length;

  return {
    setorAtual, dataInicial, dataFinal, dias, ehAlcon, ehUEN, totalLeitos,
    internacoesMes: admissoes.length,
    altasMes, obitosMes, evasoesMes, transfMes, totalSaidasMes,
    totalPacienteDia, totalLeitoDia, capacidadeAcumulada, picoDiario,
    taxaOcupacaoPeriodo, mediaPermanencia, mediaPacientesDia, rnsInternados,
    partos, peso, porDia
  };
}

function dentroDoIntervaloRelatorio(val, chaveInicial, chaveFinal) {
  const k = chaveDia(val);
  if (!k) return false;
  return k >= chaveInicial && k <= chaveFinal;
}

async function gerarRelatorioGerencial(D, dados) {
  const setorFiltro = String((dados && dados.setor) || '').trim();
  const dataInicial = String((dados && dados.dataInicial) || '').trim();
  const dataFinal = String((dados && dados.dataFinal) || '').trim();
  const indicador = String((dados && dados.indicador) || 'Geral').trim();
  if (!dataInicial || !dataFinal) throw new Error('Informe a data inicial e a data final do relatório.');

  const chaveInicial = Number(dataInicial.replace(/-/g, ''));
  const chaveFinal = Number(dataFinal.replace(/-/g, ''));
  if (!chaveInicial || !chaveFinal || chaveInicial > chaveFinal) {
    throw new Error('Período inválido: a data inicial deve ser anterior ou igual à data final.');
  }

  const todosSetores = (await D.setores()).map(s => s.Nome_Setor);
  const ehTodos = !setorFiltro || setorFiltro.toUpperCase().indexOf('TODOS') === 0;
  const setoresEscopo = ehTodos ? todosSetores : [setorFiltro];

  const internacoesTodas = await D.internacoes();
  const movimentacoesTodas = await D.movimentacoes();
  const leitosTodos = await D.leitos();
  const pacientesTodos = await D.pacientes();
  const mapaPacientes = {};
  pacientesTodos.forEach(p => { mapaPacientes[String(p.ID_Paciente)] = p; });

  const [ai, mi, di] = dataInicial.split('-').map(Number);
  const dtInicioObj = new Date(ai, mi - 1, di);
  const [af, mf, df] = dataFinal.split('-').map(Number);
  const dtFimObj = new Date(af, mf - 1, df);
  const dias = Math.round((dtFimObj - dtInicioObj) / 86400000) + 1;

  const base = {
    setor: ehTodos ? 'Todos os Setores' : setorFiltro,
    dataInicial: formatarDataStr(dataInicial),
    dataFinal: formatarDataStr(dataFinal),
    dias, indicador
  };

  function dadosDoSetor(nomeSetor) {
    const intS = internacoesTodas.filter(i => String(i.ID_Setor).trim().toUpperCase() === nomeSetor.toUpperCase());
    const idsS = new Set(intS.map(i => String(i.ID_Internacao)));
    const movsS = movimentacoesTodas.filter(m => idsS.has(String(m.ID_Internacao)));
    return { intS, movsS };
  }

  if (indicador === 'Geral') {
    const linhas = [];
    let admTotal = 0, altasTotal = 0, obitosTotal = 0, transfTotal = 0, pacienteDiaTotal = 0;
    const somaPorDia = {};

    setoresEscopo.forEach(setor => {
      const { intS, movsS } = dadosDoSetor(setor);
      const mapaSaidasS = {};
      movsS.forEach(m => { if (!mapaSaidasS[String(m.ID_Internacao)]) mapaSaidasS[String(m.ID_Internacao)] = m.Data_Hora_Saida; });

      const ehUENs = setor.trim().toUpperCase() === SETOR_UEN;
      const ehAlcons = ehSetorAlcon(setor);
      // ALCON: a admissão conjunta Mãe+RN conta como UMA internação (episódio do binômio).
      const intPeriodo = intS.filter(i => dentroDoIntervaloRelatorio(i.Data_Hora_Entrada, chaveInicial, chaveFinal));
      const admissoes = ehAlcons ? episodiosAlcon(intPeriodo, mapaSaidasS).length : intPeriodo.length;
      const altas = movsS.filter(m => String(m.Tipo_Movimento).trim() === 'Alta' && dentroDoIntervaloRelatorio(m.Data_Hora_Saida, chaveInicial, chaveFinal)).length;
      const obitos = movsS.filter(m => String(m.Tipo_Movimento).trim() === 'Obito' && dentroDoIntervaloRelatorio(m.Data_Hora_Saida, chaveInicial, chaveFinal)).length;
      const transferencias = movsS.filter(m => String(m.Tipo_Movimento).trim() === 'Transferencia' && dentroDoIntervaloRelatorio(m.Data_Hora_Saida, chaveInicial, chaveFinal)).length;

      let pacienteDia = 0, pico = 0;
      for (let k = 0; k < dias; k++) {
        const dt = new Date(ai, mi - 1, di + k);
        const diaKey = chaveDia(dt);
        // ALCON: ocupação física (1 leito ocupado pelo binômio Mãe+RN) — não duplica a Mãe e o RN.
        const n = ehUENs ? contarPacientesDiaUEN(intS, mapaSaidasS, diaKey)
          : (ehAlcons ? contarLeitosOcupadosNoDia(intS, mapaSaidasS, diaKey) : contarPacientesNoDia(intS, mapaSaidasS, diaKey));
        pacienteDia += n;
        if (n > pico) pico = n;
        somaPorDia[diaKey] = (somaPorDia[diaKey] || 0) + n;
      }

      const totalLeitosSetor = leitosTodos.filter(l => String(l.ID_Setor).trim().toUpperCase() === setor.toUpperCase()).length;
      const ocupacaoFisica = (!ehUENs && totalLeitosSetor > 0)
        ? ((pacienteDia / (totalLeitosSetor * dias)) * 100).toFixed(2) + '%'
        : '—';

      admTotal += admissoes; altasTotal += altas; obitosTotal += obitos; transfTotal += transferencias; pacienteDiaTotal += pacienteDia;
      linhas.push({
        setor, admissoes, altas, obitos, transferencias, pacienteDia,
        mediaDia: dias > 0 ? (pacienteDia / dias).toFixed(1) : '0.0',
        pico, ocupacaoFisica
      });
    });

    const chaves = Object.keys(somaPorDia);
    const picoGeral = chaves.length ? Math.max.apply(null, chaves.map(k => somaPorDia[k])) : 0;
    const totalSaidas = altasTotal + obitosTotal + transfTotal;
    const mortalidade = totalSaidas > 0 ? ((obitosTotal / totalSaidas) * 100).toFixed(1) : '0.0';

    return Object.assign({}, base, {
      tipo: 'geral',
      kpis: {
        admissoes: admTotal, altas: altasTotal, obitos: obitosTotal, transferencias: transfTotal,
        pacienteDia: pacienteDiaTotal,
        mediaDia: dias > 0 ? (pacienteDiaTotal / dias).toFixed(1) : '0.0',
        pico: picoGeral, mortalidade
      },
      linhas
    });
  }

  if (indicador === 'Admissoes') {
    const porProcedencia = {};
    let total = 0;
    setoresEscopo.forEach(setor => {
      const { intS, movsS } = dadosDoSetor(setor);
      const intPeriodo = intS.filter(i => dentroDoIntervaloRelatorio(i.Data_Hora_Entrada, chaveInicial, chaveFinal));
      let lista = intPeriodo;
      if (ehSetorAlcon(setor)) {
        const mapaSaidasS = {};
        movsS.forEach(m => { if (!mapaSaidasS[String(m.ID_Internacao)]) mapaSaidasS[String(m.ID_Internacao)] = m.Data_Hora_Saida; });
        lista = episodiosAlcon(intPeriodo, mapaSaidasS).map(e => e.representante);   // binômio = 1 admissão
      }
      lista.forEach(i => {
        const proc = String(i.Procedencia || '').trim() || 'Não informado';
        porProcedencia[proc] = (porProcedencia[proc] || 0) + 1;
        total++;
      });
    });
    const linhas = Object.keys(porProcedencia)
      .sort((a, b) => porProcedencia[b] - porProcedencia[a])
      .map(proc => ({ procedencia: proc, quantidade: porProcedencia[proc] }));
    return Object.assign({}, base, { tipo: 'admissoes', total, linhas });
  }

  const TIPOS_LISTA = { Altas: 'Alta', Obitos: 'Obito', Transferencias: 'Transferencia' };
  if (TIPOS_LISTA[indicador]) {
    const tipoMov = TIPOS_LISTA[indicador];
    const linhas = [];
    setoresEscopo.forEach(setor => {
      const { movsS } = dadosDoSetor(setor);
      movsS
        .filter(m => String(m.Tipo_Movimento).trim() === tipoMov && dentroDoIntervaloRelatorio(m.Data_Hora_Saida, chaveInicial, chaveFinal))
        .forEach(m => {
          const internacao = internacoesTodas.find(i => String(i.ID_Internacao) === String(m.ID_Internacao));
          const paciente = internacao ? mapaPacientes[String(internacao.ID_Paciente)] : null;
          linhas.push({
            nome: paciente ? paciente.Nome : '(paciente não encontrado)',
            setor,
            data: formatarDataHoraStr(m.Data_Hora_Saida),
            destino: m.Destino || '',
            observacao: m.Observacao || ''
          });
        });
    });
    linhas.sort((a, b) => a.data.localeCompare(b.data));
    return Object.assign({}, base, { tipo: 'lista', titulo: indicador, linhas });
  }

  if (indicador === 'Internados') {
    const linhas = [];
    setoresEscopo.forEach(setor => {
      const { intS, movsS } = dadosDoSetor(setor);
      const mapaSaidasS = {};
      movsS.forEach(m => { if (!mapaSaidasS[String(m.ID_Internacao)]) mapaSaidasS[String(m.ID_Internacao)] = m.Data_Hora_Saida; });

      intS.forEach(i => {
        const entradaKey = chaveDia(i.Data_Hora_Entrada);
        const saidaVal = mapaSaidasS[String(i.ID_Internacao)];
        const saidaKey = saidaVal ? chaveDia(saidaVal) : null;
        // Esteve internado em algum momento do período: entrou até o fim do período E
        // (ainda não saiu OU a saída ocorreu dentro ou depois do início do período).
        const sobrepoe = entradaKey && entradaKey <= chaveFinal && (!saidaKey || saidaKey >= chaveInicial);
        if (!sobrepoe) return;
        const paciente = mapaPacientes[String(i.ID_Paciente)];
        linhas.push({
          nome: paciente ? paciente.Nome : '(paciente não encontrado)',
          setor,
          entrada: formatarDataHoraStr(i.Data_Hora_Entrada),
          status: i.Status || '',
          procedencia: i.Procedencia || ''
        });
      });
    });
    linhas.sort((a, b) => a.entrada.localeCompare(b.entrada));
    return Object.assign({}, base, { tipo: 'lista', titulo: 'Internados', linhas });
  }

  throw new Error('Indicador de relatório não reconhecido: ' + indicador);
}

module.exports = { calcularIndicadoresSetor, calcularIndicadoresPeriodo, episodiosAlcon, calcularRNsAlconNoMes, obterInternacoesHojeAlcon, obterEstatisticasDashboard,
  obterEstatisticasDashboardGeral, gerarRelatorioGerencial };
