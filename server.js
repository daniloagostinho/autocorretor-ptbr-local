const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const LANGUAGETOOL_URL =
  process.env.LANGUAGETOOL_URL || 'http://localhost:8010/v2/check';
const PUBLIC_LANGUAGETOOL_URL =
  process.env.PUBLIC_LANGUAGETOOL_URL || 'https://api.languagetool.org/v2/check';

function preserveCase(input, replacement) {
  if (input === input.toUpperCase()) {
    return replacement.toUpperCase();
  }

  if (input[0] === input[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }

  return replacement;
}

function buildAggressiveMatches(text) {
  const matches = [];

  const wordMap = {
    vc: 'você',
    vcs: 'vocês',
    voce: 'você',
    ce: 'cê',
    pq: 'porque',
    q: 'que',
    tbm: 'também',
    tb: 'também',
    ta: 'tá',
    to: 'tô',
    eh: 'é',
    nao: 'não'
  };

  for (const [from, to] of Object.entries(wordMap)) {
    const regex = new RegExp(`\\b${from}\\b`, 'gi');

    for (const found of text.matchAll(regex)) {
      if (typeof found.index !== 'number') continue;
      const original = found[0];
      const replacement = preserveCase(original, to);

      if (original === replacement) continue;

      matches.push({
        offset: found.index,
        length: original.length,
        replacements: [{ value: replacement }],
        rule: { id: `LOCAL_${from.toUpperCase()}`, issueType: 'misspelling' },
        category: { id: 'LOCAL' },
        message: 'Normalização local agressiva pt-BR',
        _priority: 2
      });
    }
  }

  // Heurística agressiva para casos como "vc e demais" -> "você é demais".
  const verbToBeRegex =
    /\b(vc|vcs|voce|você|ce|cê|ele|ela|isso|isto|essa|esse|eu|tu)\s+e(?=\s+[a-zà-ú]{2,}\b)/gi;

  for (const found of text.matchAll(verbToBeRegex)) {
    if (typeof found.index !== 'number') continue;
    const offset = found.index + found[0].length - 1;

    matches.push({
      offset,
      length: 1,
      replacements: [{ value: 'é' }],
      rule: { id: 'LOCAL_VERB_SER', issueType: 'typographical' },
      category: { id: 'LOCAL' },
      message: 'Ajuste local para verbo "ser"',
      _priority: 2
    });
  }

  return matches;
}

function mergeNonOverlappingMatches(localMatches, ltMatches) {
  const all = [
    ...localMatches,
    ...ltMatches.map((m) => ({ ...m, _priority: 1 }))
  ];

  all.sort((a, b) => {
    if ((b._priority || 1) !== (a._priority || 1)) {
      return (b._priority || 1) - (a._priority || 1);
    }
    if (a.offset !== b.offset) return a.offset - b.offset;
    return b.length - a.length;
  });

  const selected = [];

  for (const candidate of all) {
    const cStart = candidate.offset;
    const cEnd = candidate.offset + candidate.length;
    const overlaps = selected.some((picked) => {
      const pStart = picked.offset;
      const pEnd = picked.offset + picked.length;
      return cStart < pEnd && pStart < cEnd;
    });

    if (!overlaps) {
      selected.push(candidate);
    }
  }

  return selected.sort((a, b) => a.offset - b.offset);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function shouldAutoApply(match, options = {}) {
  const allowPunctuation = options.allowPunctuation !== false;
  const issueType = match.rule?.issueType || '';
  const categoryId = match.rule?.category?.id || '';
  const ruleId = match.rule?.id || '';
  const replacement = match.replacements?.[0]?.value;

  if (!replacement) return false;

  if (ruleId.startsWith('LOCAL_')) {
    return true;
  }

  if (issueType === 'misspelling' || issueType === 'typographical') {
    return true;
  }

  // Keep punctuation auto-fixes conservative to avoid changing meaning.
  if (allowPunctuation && categoryId === 'PUNCTUATION' && replacement.length <= 2) {
    return true;
  }

  return false;
}

function applyMatches(text, matches, options = {}) {
  let updatedText = text;
  const applied = [];

  const safeMatches = matches
    .filter((match) => shouldAutoApply(match, options))
    .filter((m) => Number.isInteger(m.offset) && Number.isInteger(m.length))
    .sort((a, b) => b.offset - a.offset);

  for (const match of safeMatches) {
    const replacement = match.replacements[0].value;
    const start = match.offset;
    const end = start + match.length;

    if (start < 0 || end > updatedText.length || start >= end) {
      continue;
    }

    const before = updatedText.slice(0, start);
    const original = updatedText.slice(start, end);
    const after = updatedText.slice(end);

    if (original === replacement) {
      continue;
    }

    updatedText = before + replacement + after;
    applied.push({
      offset: start,
      original,
      replacement,
      ruleId: match.rule?.id || 'UNKNOWN',
      message: match.message || ''
    });
  }

  return {
    text: updatedText,
    applied: applied.reverse()
  };
}

app.post('/api/correct', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const autoPunctuation = req.body?.autoPunctuation !== false;
    const aggressive = req.body?.aggressive !== false;

    if (!text.trim()) {
      return res.json({ text, applied: [] });
    }

    const body = new URLSearchParams({
      text,
      language: 'pt-BR'
    });

    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    };

    let response;
    let source = 'local';

    try {
      response = await fetch(LANGUAGETOOL_URL, requestOptions);
      if (!response.ok) {
        throw new Error(`Local unavailable (${response.status})`);
      }
    } catch (error) {
      source = 'public';
      response = await fetch(PUBLIC_LANGUAGETOOL_URL, requestOptions);
    }

    if (!response.ok) {
      const details = await response.text();
      return res.status(502).json({
        error: 'Falha ao consultar o LanguageTool local.',
        details
      });
    }

    const result = await response.json();
    const ltMatches = Array.isArray(result.matches) ? result.matches : [];
    const localMatches = aggressive ? buildAggressiveMatches(text) : [];
    const matches = mergeNonOverlappingMatches(localMatches, ltMatches);

    const corrected = applyMatches(text, matches, {
      allowPunctuation: autoPunctuation
    });
    return res.json({ ...corrected, source });
  } catch (error) {
    return res.status(500).json({
      error: 'Erro interno ao corrigir texto.',
      details: error.message
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
