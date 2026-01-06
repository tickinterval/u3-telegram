function nowIso() {
  return new Date().toISOString();
}

function parseCommand(text) {
  if (!text) {
    return null;
  }
  const trimmed = String(text).trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }
  const [raw, ...args] = trimmed.split(/\s+/);
  const command = raw.slice(1).split('@')[0].toLowerCase();
  if (!command) {
    return null;
  }
  return { command, args };
}

function normalizeTxid(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) {
    return null;
  }
  const match = cleaned.match(/^(0x)?[0-9a-fA-F]{64}$/);
  if (!match) {
    return null;
  }
  return cleaned.startsWith('0x') ? cleaned.toLowerCase() : `0x${cleaned.toLowerCase()}`;
}

module.exports = {
  nowIso,
  parseCommand,
  normalizeTxid,
};
