const R = require('./regras');
const norm = v => String(v || '').trim().toUpperCase().replace('MÃE', 'MAE');
function tipoInternacao(i) {
  const tipo = norm(i.tipo_paciente || i.Tipo_Paciente);
  if (['MAE', 'RN'].includes(tipo)) return tipo;
  const setor = norm(i.setor_nome || i.ID_Setor);
  if (setor === 'UTI MATERNA') return 'MAE';
  if (R.ehSetorNeonatal(setor) && !R.ehSetorAlcon(setor)) return 'RN';
  return '';
}
function resolverTipo(i, informado) {
  const salvo = tipoInternacao(i), escolhido = norm(informado);
  if (escolhido && !['MAE','RN'].includes(escolhido)) throw new Error('Selecione Mãe ou RN.');
  if (salvo && escolhido && salvo !== escolhido) throw new Error('O tipo informado difere do cadastro. Corrija a internação antes de transferir.');
  return salvo || escolhido;
}
function aceitaLeito(l, tipo) {
  const status = norm(l.status || l.Status);
  if (status === 'LIVRE') return true;
  const mae = l.id_paciente_mae || l.ID_Paciente_Mae, rn = l.id_paciente_rn || l.ID_Paciente_RN;
  return status === 'OCUPADO' && (tipo === 'MAE' ? !mae && !!rn : tipo === 'RN' ? !rn && !!mae : false);
}
module.exports = { tipoInternacao, resolverTipo, aceitaLeito };
