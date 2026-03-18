const editor = document.getElementById('editor');
const statusEl = document.getElementById('status');
const changesList = document.getElementById('changesList');
const copyBtn = document.getElementById('copyBtn');
const autoPunctuation = document.getElementById('autoPunctuation');

let debounceTimer;
let isApplying = false;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b91c1c' : '#166534';
}

function updateChanges(applied) {
  if (!applied.length) return;

  const recent = applied.slice(-5).reverse();
  changesList.innerHTML = '';

  for (const change of recent) {
    const li = document.createElement('li');
    li.textContent = `"${change.original}" -> "${change.replacement}"`;
    changesList.appendChild(li);
  }
}

function adjustCaret(caret, applied) {
  let adjusted = caret;

  for (const change of applied) {
    const start = change.offset;
    const oldLen = change.original.length;
    const newLen = change.replacement.length;
    const end = start + oldLen;

    if (adjusted > end) {
      adjusted += newLen - oldLen;
    } else if (adjusted >= start) {
      adjusted = start + newLen;
    }
  }

  return adjusted;
}

async function autoCorrect() {
  if (isApplying) return;

  const text = editor.value;
  const caret = editor.selectionStart;

  if (!text.trim()) {
    setStatus('Pronto');
    return;
  }

  setStatus('Corrigindo...');

  try {
    const response = await fetch('/api/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, autoPunctuation: autoPunctuation.checked })
    });

    if (!response.ok) {
      throw new Error('Falha na correcao local');
    }

    const data = await response.json();
    const applied = Array.isArray(data.applied) ? data.applied : [];
    const source = data.source || 'desconhecido';

    if (data.text !== text && applied.length > 0) {
      isApplying = true;
      const nextCaret = adjustCaret(caret, applied);
      editor.value = data.text;
      editor.setSelectionRange(nextCaret, nextCaret);
      updateChanges(applied);
      isApplying = false;
      setStatus(`Corrigido automaticamente (${applied.length}) [${source}]`);
    } else {
      setStatus(`Sem ajustes [${source}]`);
    }
  } catch (error) {
    setStatus('Erro ao corrigir. Verifique o backend.', true);
  }
}

editor.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(autoCorrect, 300);
});

editor.addEventListener('keydown', (event) => {
  if (event.key === ' ' || event.key === 'Enter' || event.key === '.') {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(autoCorrect, 120);
  }
});

editor.addEventListener('blur', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(autoCorrect, 50);
});

editor.addEventListener('paste', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(autoCorrect, 120);
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(editor.value);
    setStatus('Texto copiado');
  } catch (error) {
    setStatus('Nao foi possivel copiar o texto.', true);
  }
});
