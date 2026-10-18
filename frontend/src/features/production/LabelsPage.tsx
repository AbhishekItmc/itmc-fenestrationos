import { ArrowLeft, FileDown, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import type { LabelLayout, Part, ProductionOrder } from '../../api/types';
import { fmtPartSize, partUrl } from '../../engine/production';
import { qrDataUrl } from '../../lib/qr';
import { useAsync } from '../../lib/useAsync';
import { useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Field';
import { ErrorBlock, LoadingBlock } from '../../ui/Misc';
import { LABEL_LAYOUTS } from './labels';

/** Physical label geometry in millimetres. */
interface Geometry {
  page: { w: number; h: number };
  label: { w: number; h: number };
  cols: number;
  rows: number;
  marginTop: number;
  marginLeft: number;
  qr: number;
  pad: number;
  codeSize: number;
  textSize: number;
}

export const LABEL_GEOMETRY: Record<LabelLayout, Geometry> = {
  'a4-24': { page: { w: 210, h: 297 }, label: { w: 70, h: 37 }, cols: 3, rows: 8, marginTop: 0.5, marginLeft: 0, qr: 27, pad: 3, codeSize: 4.2, textSize: 2.5 },
  'a4-8': { page: { w: 210, h: 297 }, label: { w: 105, h: 74 }, cols: 2, rows: 4, marginTop: 0.5, marginLeft: 0, qr: 48, pad: 5, codeSize: 6.5, textSize: 3.4 },
  'roll-62x29': { page: { w: 62, h: 29 }, label: { w: 62, h: 29 }, cols: 1, rows: 1, marginTop: 0, marginLeft: 0, qr: 23, pad: 2.5, codeSize: 3.9, textSize: 2.3 },
};

const isLayout = (s: string | null): s is LabelLayout => s === 'a4-24' || s === 'a4-8' || s === 'roll-62x29';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function Label({ part, order, projectCode, g, qr }: { part: Part; order: ProductionOrder; projectCode: string; g: Geometry; qr: string | undefined }) {
  const mm = (v: number) => `${v}mm`;
  return (
    <div className="fos-label flex overflow-hidden bg-sheet text-ink" style={{ width: mm(g.label.w), height: mm(g.label.h), padding: mm(g.pad), gap: mm(g.pad) }} data-testid={`label-${part.code}`}>
      {qr ? <img src={qr} alt={`QR ${part.code}`} style={{ width: mm(g.qr), height: mm(g.qr) }} className="shrink-0 self-center [image-rendering:pixelated]" data-testid="label-qr" /> : <div style={{ width: mm(g.qr), height: mm(g.qr) }} className="shrink-0 self-center bg-ink/10" />}
      <div className="flex min-w-0 flex-1 flex-col justify-center" style={{ fontSize: mm(g.textSize), lineHeight: 1.22 }}>
        <div className="font-mono font-semibold tracking-wider" style={{ fontSize: mm(g.codeSize), lineHeight: 1.1 }}>
          {part.code}
        </div>
        <div className="mt-[0.6mm] font-semibold">
          {part.mark}·{part.seq} <span className="font-normal">{part.kind}</span>
        </div>
        <div className="line-clamp-2 break-words">{part.description}</div>
        <div className="font-mono">{fmtPartSize(part)}</div>
        <div className="mt-auto break-words font-semibold leading-tight opacity-80" style={{ fontSize: '0.86em' }}>
          {projectCode} · {order.number}
        </div>
      </div>
    </div>
  );
}

export default function LabelsPage() {
  const be = useBackend();
  const mode = useApp((s) => s.mode);
  const { orderId } = useParams();
  const [sp, setSp] = useSearchParams();
  const layout: LabelLayout = isLayout(sp.get('layout')) ? (sp.get('layout') as LabelLayout) : 'a4-24';
  const g = LABEL_GEOMETRY[layout];
  const id = Number(orderId);
  const data = useAsync(async () => {
    const [order, parts] = await Promise.all([be.getProductionOrder(id), be.listParts(id)]);
    const projects = useApp.getState().projects;
    const project = projects.find((p) => p.id === order.project_id) ?? (await be.getProject(order.project_id).catch(() => null));
    return { order, parts: [...parts].sort((a, b) => a.kind.localeCompare(b.kind) || a.mark.localeCompare(b.mark, undefined, { numeric: true }) || a.seq - b.seq), projectCode: project?.code ?? '' };
  }, [be, id]);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const origin = typeof location !== 'undefined' ? location.origin : '';

  useEffect(() => {
    if (!data.data) return;
    let alive = true;
    Promise.all(data.data.parts.map(async (p) => [p.code, await qrDataUrl(partUrl(origin, p.code), 300)] as const))
      .then((pairs) => alive && setQrs(Object.fromEntries(pairs)))
      .catch((e) => toast.error('QR rendering failed', errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [data.data, origin]);

  const pages = useMemo(() => (data.data ? chunk(data.data.parts, g.cols * g.rows) : []), [data.data, g]);
  const ready = !!data.data && Object.keys(qrs).length === data.data.parts.length;

  const pageCss = `
    @page { size: ${g.page.w}mm ${g.page.h}mm; margin: 0; }
    @media print {
      html, body, #root { height: auto !important; overflow: visible !important; background: white !important; }
      .no-print { display: none !important; }
      .labels-scroll { overflow: visible !important; height: auto !important; padding: 0 !important; background: white !important; }
      .label-sheet { margin: 0 !important; box-shadow: none !important; outline: none !important; break-after: page; page-break-after: always; }
      .label-sheet:last-child { break-after: auto; page-break-after: auto; }
      .fos-label { outline: none !important; color: black !important; background: white !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }`;

  return (
    <div className="flex h-full flex-col bg-bg" data-testid="labels-page">
      <style>{pageCss}</style>
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Link to={`/production/${id}`} className="btn btn-ghost" data-testid="labels-back">
          <ArrowLeft className="h-4 w-4" /> Work order
        </Link>
        <div className="min-w-0">
          <div className="text-sm font-semibold">QR labels {data.data ? `· ${data.data.order.number}` : ''}</div>
          <div className="text-2xs text-muted">
            {data.data ? `${data.data.parts.length} labels · ${pages.length} page(s) · ` : ''}QR → <span className="font-mono">{origin}/p/&lt;code&gt;</span>
          </div>
        </div>
        <div className="flex-1" />
        <Segmented value={layout} onChange={(v) => setSp({ layout: v }, { replace: true })} options={LABEL_LAYOUTS.map((l) => ({ value: l.value, label: l.label, tip: l.detail }))} testId="label-layout" />
        {mode === 'server' && (
          <Button icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => void be.downloadReport('labels', id, 'pdf', { layout }).catch((e) => toast.error('Download failed', errorMessage(e)))} data-testid="labels-pdf">
            Server PDF
          </Button>
        )}
        <Button variant="solid" icon={<Printer className="h-3.5 w-3.5" />} disabled={!ready} onClick={() => window.print()} data-testid="labels-print">
          Print
        </Button>
      </div>
      <div className="labels-scroll min-h-0 flex-1 overflow-auto p-6">
        {data.loading && !data.data ? (
          <LoadingBlock label="Preparing labels…" />
        ) : data.error || !data.data ? (
          <ErrorBlock message={data.error ?? 'Not found'} />
        ) : !data.data.parts.length ? (
          <div className="p-6 text-center text-sm text-muted">This work order has no parts.</div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            {pages.map((pg, i) => (
              <div
                key={i}
                className="label-sheet shrink-0 bg-sheet shadow-pop"
                style={{
                  width: `${g.page.w}mm`,
                  height: `${g.page.h}mm`,
                  paddingTop: `${g.marginTop}mm`,
                  paddingLeft: `${g.marginLeft}mm`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${g.cols}, ${g.label.w}mm)`,
                  gridAutoRows: `${g.label.h}mm`,
                }}
                data-testid="label-sheet"
              >
                {pg.map((p) => (
                  <div key={p.id} className="outline-dashed outline-1 -outline-offset-1 outline-line-strong/60 print:outline-none">
                    <Label part={p} order={data.data!.order} projectCode={data.data!.projectCode} g={g} qr={qrs[p.code]} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
