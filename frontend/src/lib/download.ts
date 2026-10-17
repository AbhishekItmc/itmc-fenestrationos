export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read file'));
    r.readAsText(file);
  });
}

/** Parse tab-separated text pasted from Excel into rows of cells (trailing empty row dropped). */
export function parseTsv(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  if (rows.length && rows[rows.length - 1].trim() === '') rows.pop();
  return rows.map((r) => r.split('\t').map((c) => c.trim()));
}
