BEGIN;
-- Ajuste de nomenclatura do RN: "RN DE <nome da mãe>" quando o parto tem apenas um RN.
-- A numeração "RN 1 DE", "RN 2 DE" fica reservada aos gemelares. A atualização é repetível
-- e atinge somente nomes gerados automaticamente pelo sistema (nunca nomes digitados).
UPDATE pacientes p
SET nome = 'RN DE ' || trim(m.nome)
FROM nascimentos n
JOIN partos pa ON pa.id_parto = n.id_parto
JOIN pacientes m ON m.id_paciente = pa.id_mae
WHERE p.id_paciente = n.id_rn
  AND (SELECT count(*) FROM nascimentos n2 WHERE n2.id_parto = n.id_parto) = 1
  AND upper(trim(p.nome)) = upper('RN ' || n.ordem || ' DE ' || trim(m.nome))
  AND upper(trim(p.nome)) <> upper('RN DE ' || trim(m.nome));
COMMIT;
