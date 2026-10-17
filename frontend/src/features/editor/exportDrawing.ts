/** Export the current CAD view as standalone SVG / PNG (CSS variables resolved, overlays removed). */
import { downloadText, safeFilename } from '../../lib/download';
import { saveBlob } from '../../api/client';

function standaloneSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('.no-export, .hits').forEach((n) => n.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  const style = getComputedStyle(svg.parentElement ?? svg);
  let text = new XMLSerializer().serializeToString(clone);
  text = text.replace(/var\((--[a-z0-9-]+)\)/gi, (_m, name: string) => style.getPropertyValue(name).trim() || '#888');
  const font = `<style>text{font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace}</style>`;
  return text.replace(/(<svg[^>]*>)/, `$1${font}`);
}

export function exportSvg(svg: SVGSVGElement, name: string): void {
  downloadText(standaloneSvg(svg), `${safeFilename(name)}.svg`, 'image/svg+xml');
}

export async function exportPng(svg: SVGSVGElement, name: string, scale = 2): Promise<void> {
  const text = standaloneSvg(svg);
  const w = Number(svg.getAttribute('width'));
  const h = Number(svg.getAttribute('height'));
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not rasterise drawing'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed');
    saveBlob(blob, `${safeFilename(name)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
