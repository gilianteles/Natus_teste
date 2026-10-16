// Fuso do hospital. Manaus não tem horário de verão (UTC-4 fixo).
// Definido ANTES de qualquer uso de Date, para que getters locais == horário de Manaus.
process.env.TZ = 'America/Manaus';
module.exports = { TZ: 'America/Manaus' };
