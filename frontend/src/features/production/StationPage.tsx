import clsx from 'clsx';
import { Camera, CameraOff, History, ScanLine, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from '../../api/client';
import type { PartDetail } from '../../api/types';
import { parseScan, stationLabel, STATIONS } from '../../engine/production';
import { fmtDateTime } from '../../lib/format';
import { loadJson, saveJson } from '../../lib/storage';
import { canWrite, useApp, useBackend } from '../../store/app';
import { Button } from '../../ui/Button';
import { EmptyState, Spinner } from '../../ui/Misc';
import { PartStatusChip } from './common';
import { PartPanel } from './PartPanel';

// --- BarcodeDetector (Shape Detection API) — not in the TS DOM lib, feature-detected at runtime ---
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
function barcodeDetector(): BarcodeDetectorCtor | null {
  const w = globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof w.BarcodeDetector === 'function' && !!navigator.mediaDevices?.getUserMedia ? w.BarcodeDetector : null;
}

interface Recent {
  code: string;
  mark: string;
  status: string;
  station: string | null;
  at: string;
}

const STATION_KEY = 'fos.workstation';
const RECENT_KEY = 'fos.workstation.recent';

export default function StationPage() {
  const be = useBackend();
  const user = useApp((s) => s.user);
  const [station, setStationState] = useState<string>(() => loadJson<string>(STATION_KEY, 'cutting'));
  const [input, setInput] = useState('');
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Recent[]>(() => loadJson<Recent[]>(RECENT_KEY, []));
  const [camera, setCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canAct = canWrite(user, 'operate');

  const setStation = (s: string) => {
    setStationState(s);
    saveJson(STATION_KEY, s);
    inputRef.current?.focus();
  };

  const remember = useCallback((d: PartDetail) => {
    setRecent((r) => {
      const next = [{ code: d.part.code, mark: `${d.part.mark}·${d.part.seq}`, status: d.part.status, station: d.part.current_station, at: new Date().toISOString() }, ...r.filter((x) => x.code !== d.part.code)].slice(0, 12);
      saveJson(RECENT_KEY, next);
      return next;
    });
  }, []);

  const lookup = useCallback(
    async (raw: string) => {
      const code = parseScan(raw);
      if (!code) return;
      setBusy(true);
      setError(null);
      try {
        const d = await be.getPart(code);
        setDetail(d);
        remember(d);
        setInput('');
      } catch (e) {
        setDetail(null);
        setError(e instanceof ApiError && e.status === 404 ? `No part with code “${code}”. Check the label or type the 8-character code.` : errorMessage(e));
      } finally {
        setBusy(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [be, remember],
  );

  const refreshDetail = async () => {
    if (!detail) return;
    try {
      const d = await be.getPart(detail.part.code);
      setDetail(d);
      remember(d);
    } catch (e) {
      setError(errorMessage(e));
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const part = detail?.part;
  const mismatch =
    part && part.status !== 'done' && part.current_station !== station ? (
      <div className="flex flex-wrap items-center gap-2">
        <span>
          This part is at <b>{stationLabel(part.current_station)}</b>, not {stationLabel(station)}.
        </span>
        <Button size="sm" onClick={() => setStation(part.current_station!)} data-testid="switch-station">
          Switch to {stationLabel(part.current_station)}
        </Button>
      </div>
    ) : part?.status === 'done' ? (
      <span>This part has completed all stations.</span>
    ) : undefined;

  return (
    <div className="h-full overflow-auto" data-testid="station-page">
      <div className="mx-auto max-w-[1200px] p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Workstation</h1>
            <div className="text-sm text-muted">Scan or type a part code, then record the step at your station.</div>
          </div>
        </div>
        <div role="radiogroup" aria-label="Station" className="mb-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-7" data-testid="station-picker">
          {STATIONS.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={station === s.id}
              onClick={() => setStation(s.id)}
              data-testid={`station-${s.id}`}
              className={clsx(
                'min-h-[44px] rounded border px-1.5 py-1 text-[13px] font-semibold leading-tight transition-colors sm:text-sm',
                station === s.id ? 'border-accent bg-accent text-[rgb(var(--on-accent))] shadow-focus' : 'border-line-strong bg-panel text-muted hover:bg-hover hover:text-fg',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr] lg:gap-4">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <form
              className="panel p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void lookup(input);
              }}
            >
              <label htmlFor="scan-input" className="label">
                Part code — scanner or keyboard, Enter to look up
              </label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
                  <input
                    id="scan-input"
                    ref={inputRef}
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    enterKeyHint="search"
                    className="input h-14 pl-11 font-mono text-xl uppercase tracking-[0.12em] placeholder:font-sans placeholder:text-base placeholder:normal-case placeholder:tracking-normal"
                    placeholder="e.g. K7M2QX9A"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    data-testid="scan-input"
                  />
                </div>
                <Button type="submit" variant="solid" className="h-14 px-5 text-md" loading={busy} disabled={!input.trim()} data-testid="scan-submit">
                  Look up
                </Button>
              </div>
              <CameraScanner
                open={camera}
                onToggle={setCamera}
                onDetected={(v) => {
                  setCamera(false);
                  void lookup(v);
                }}
              />
            </form>
          </div>

          <div className="panel min-w-0 p-3 sm:p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-[320px]" data-testid="station-part">
            {busy && !detail ? (
              <div className="flex h-40 items-center justify-center">
                <Spinner label="Looking up part…" />
              </div>
            ) : error ? (
              <EmptyState icon={<X className="h-5 w-5 text-err" />} title="Part not found" detail={error} />
            ) : detail ? (
              <PartPanel detail={detail} station={station} onChanged={() => void refreshDetail()} size="lg" canAct={canAct} mismatch={mismatch} />
            ) : (
              <EmptyState icon={<ScanLine className="h-5 w-5" />} title={`Ready at ${stationLabel(station)}`} detail="Scan a part label (QR) or type its code. The part card with Start / Complete / Block appears here." />
            )}
          </div>

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <div className="panel">
              <div className="panel-head h-9 text-xs">
                <History className="h-3.5 w-3.5 text-faint" /> Recent scans
                {recent.length > 0 && (
                  <button
                    className="ml-auto text-2xs font-normal text-faint hover:text-fg"
                    onClick={() => {
                      setRecent([]);
                      saveJson(RECENT_KEY, []);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {!recent.length ? (
                <div className="px-3 py-4 text-sm text-faint">Nothing scanned on this device yet.</div>
              ) : (
                <ul className="divide-y divide-line/60" data-testid="recent-scans">
                  {recent.map((r) => (
                    <li key={r.code}>
                      <button className="flex min-h-[44px] w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover" onClick={() => void lookup(r.code)}>
                        <span className="font-mono text-sm font-semibold text-accent">{r.code}</span>
                        <span className="font-mono text-xs text-muted">{r.mark}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-faint">{r.status === 'done' ? 'done' : stationLabel(r.station)}</span>
                        <PartStatusChip status={r.status as PartDetail['part']['status']} />
                        <span className="hidden font-mono text-2xs text-faint sm:inline">{fmtDateTime(r.at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function CameraScanner({ open, onToggle, onDetected }: { open: boolean; onToggle: (v: boolean) => void; onDetected: (v: string) => void }) {
  const Detector = barcodeDetector();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const cb = useRef(onDetected);
  cb.current = onDetected;

  useEffect(() => {
    if (!open || !Detector) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let alive = true;
    const detector = new Detector({ formats: ['qr_code', 'code_128', 'code_39'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!alive || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (!alive || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.find((c) => parseScan(c.rawValue));
            if (hit) {
              cb.current(hit.rawValue);
              return;
            }
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, Detector]);

  if (!Detector)
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-faint" data-testid="camera-unsupported">
        <CameraOff className="h-3.5 w-3.5 shrink-0" /> Camera scanning not supported on this browser — type the code.
      </div>
    );
  return (
    <div className="mt-2">
      <Button
        className="h-11 w-full justify-center"
        icon={open ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
        onClick={() => {
          setErr(null);
          onToggle(!open);
        }}
        data-testid="camera-toggle"
      >
        {open ? 'Stop camera' : 'Scan with camera'}
      </Button>
      {open && (
        <div className="relative mt-2 overflow-hidden rounded border border-line-strong bg-bg">
          <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-[18%] rounded border-2 border-accent/80" />
        </div>
      )}
      {err && <div className="mt-1 text-xs text-err">Camera unavailable: {err}</div>}
    </div>
  );
}
