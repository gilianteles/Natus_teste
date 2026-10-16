const { upper } = require('./util');

// Perfis com acesso à gestão (dashboards gerais, painel NIR, setores e relatórios).
const PERFIS_ADMINISTRATIVOS = ['NIR', 'SAME', 'NIR/SAME', 'GESTÃO', 'ADMINISTRADOR'];
// Perfis com acesso "tipo NIR" (visão de todos os setores).
const PERFIS_COM_ACESSO_TIPO_NIR = ['NIR', 'GESTÃO', 'ADMINISTRADOR'];
// FASE 3: somente estes perfis (ou usuários com a marca `administrador`) cadastram usuários.
const PERFIS_ADMINISTRADOR = ['ADMINISTRADOR', 'ADMIN'];
// Perfis de acesso oferecidos no cadastro de colaboradores.
const PERFIS_ACESSO = ['Administrador', 'Operador', 'Visualizador', 'NIR', 'SAME', 'NIR/SAME', 'Gestão', 'Setor'];
const STATUS_USUARIO = ['Ativo', 'Inativo'];
// Cargos/funções sugeridos no cadastro (lista livre: o servidor aceita qualquer texto).
const CARGOS_SUGERIDOS = ['Enfermeiro(a) Obstetra', 'Médico(a) Ginecologista', 'Regulador(a) NIR', 'Técnico(a) de Enfermagem',
  'Recepcionista', 'Administrador', 'Assistente Administrativo', 'Fisioterapeuta', 'Fonoaudiólogo(a)', 'Nutricionista', 'Serviço Social'];

const SETORES_INTERNOS = ['CCO', 'PPP', 'UCINCA', 'UCINCO', 'UTIN 1', 'UTIN 2', 'UTIN 3', 'ALCON 1', 'ALCON 2', 'UTI MATERNA', 'CUIDADOS ESPECIAIS', 'ABRIGO', 'UEN'];
const SETOR_UEN = 'UEN';
const ROTULO_SETOR_UEN = 'Leito Extra CCO Neonatal';
const SETORES_ALCON = ['ALCON 1', 'ALCON 2'];
const SETORES_PADRAO = ['UTIN 1', 'UTIN 2', 'UTIN 3', 'UCINCO', 'UCINCA', 'ALCON 1', 'ALCON 2', 'UTI MATERNA'];

// FASE 1 — ACR: classificação de risco (protocolo de Manchester) e status do atendimento.
const SETOR_ACR = 'ACR';
const RISCOS_ACR = ['Vermelho', 'Laranja', 'Amarelo', 'Verde', 'Azul'];
const STATUS_ATENDIMENTO_ACR = ['Aguardando', 'Em Atendimento', 'Encaminhado', 'Alta', 'Desistencia'];

// FASE 2 — Kanban NIR: colunas na ordem do fluxo de regulação.
const COLUNAS_KANBAN = ['aguardando', 'internado', 'documentacao', 'alta'];
const ROTULO_COLUNA_KANBAN = {
  aguardando: 'Aguardando Avaliação (Triagem/ACR)',
  internado: 'Internado / Ativo',
  documentacao: 'Aguardando Documentação',
  alta: 'Pronto para Alta / Transferência'
};
// Status operacional gravado em internacoes.status_regulacao ao mover o card.
const STATUS_REGULACAO_POR_COLUNA = {
  aguardando: '',
  internado: 'Em investigação/tratamento',
  documentacao: 'Aguardando documentação',
  alta: 'Pronto para alta/transferência'
};

const ehPerfilNIR = p => PERFIS_COM_ACESSO_TIPO_NIR.includes(upper(p));
const ehPerfilAdministrativo = p => PERFIS_ADMINISTRATIVOS.includes(upper(p));
const ehPerfilAdministrador = p => PERFIS_ADMINISTRADOR.includes(upper(p));
const ehSetorAlcon = s => SETORES_ALCON.includes(upper(s));
const ehMae = t => ['MAE', 'MÃE'].includes(upper(t));
const classificarMovimentoInterno = v => { const x = upper(v); return SETORES_INTERNOS.some(s => x === s || x.indexOf(s + ' -') === 0); };
const classificarProcedenciaInterna = v => SETORES_INTERNOS.includes(upper(v));

module.exports = { PERFIS_ADMINISTRATIVOS, PERFIS_COM_ACESSO_TIPO_NIR, PERFIS_ADMINISTRADOR, PERFIS_ACESSO, STATUS_USUARIO, CARGOS_SUGERIDOS,
  SETORES_INTERNOS, SETOR_UEN, ROTULO_SETOR_UEN, SETORES_ALCON, SETORES_PADRAO,
  SETOR_ACR, RISCOS_ACR, STATUS_ATENDIMENTO_ACR, COLUNAS_KANBAN, ROTULO_COLUNA_KANBAN, STATUS_REGULACAO_POR_COLUNA,
  ehPerfilNIR, ehPerfilAdministrativo, ehPerfilAdministrador, ehSetorAlcon, ehMae, classificarMovimentoInterno, classificarProcedenciaInterna };
