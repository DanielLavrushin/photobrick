// The printable pages: a cover with the whole mosaic, facts, panel map and colour legend, then one
// page per 16 x 16 panel with every stud's colour and 2-character code. Sizes are in mm (A4).

import { PANEL_EMPTY, PANEL_STUDS, panelLabel, type Panel, type Rgb } from '@photobrick/engine';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtInt, fmtOne } from '../lib/format.ts';
import { rgbCss, textOn } from '../lib/palette.ts';
import type { MosaicData } from '../ui/useMosaicData.ts';

const RED = '#c63a2b';

export interface SheetInfo {
  name: string;
  date: string;
  page: number;
  pages: number;
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="5mm" height="5mm" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#26282d" />
      <circle cx="10.5" cy="10.5" r="5.8" fill="#c63a2b" />
      <circle cx="21.5" cy="10.5" r="5.8" fill="#f2b705" />
      <circle cx="10.5" cy="21.5" r="5.8" fill="#1f5fae" />
      <circle cx="21.5" cy="21.5" r="5.8" fill="#ece9e2" />
    </svg>
  );
}

function Sheet({ info, children, testId }: { info: SheetInfo; children: ReactNode; testId?: string }) {
  const { t } = useTranslation();
  return (
    <section className="pb-sheet" data-testid={testId}>
      <header className="pb-head">
        <span className="pb-brand">
          <Logo />
          {t('app.name')}
        </span>
        <span>{info.name}</span>
      </header>
      {children}
      <footer className="pb-foot">
        <span>{t('print.footer', { date: info.date })}</span>
        <span>{t('print.pageOf', { page: info.page, pages: info.pages })}</span>
      </footer>
    </section>
  );
}

/** A stud: disc in its colour with the 2-character code in black or white, whichever reads better. */
function CodeDot({ rgb, code, size }: { rgb: Rgb; code: string; size: string }) {
  return (
    <svg viewBox="0 0 1 1" width={size} height={size} aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="0.5" cy="0.5" r="0.46" fill={rgbCss(rgb)} stroke="rgba(0,0,0,0.35)" strokeWidth="0.03" />
      <text x="0.5" y="0.52" fontSize="0.38" fontWeight="700" textAnchor="middle" dominantBaseline="central" fill={textOn(rgb)}>
        {code}
      </text>
    </svg>
  );
}

/** Panel layout with labels; `highlight` marks one panel. Size fits in maxW x maxH mm. */
export function PanelMap({ w, h, maxW, maxH, highlight }: { w: number; h: number; maxW: number; maxH: number; highlight?: { px: number; py: number } }) {
  const cell = Math.min(maxW / w, maxH / h, 14);
  const showLabels = cell >= 5;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={`${w * cell}mm`} height={`${h * cell}mm`} role="img" aria-hidden="true" style={{ display: 'block' }}>
      {Array.from({ length: h }, (_, py) =>
        Array.from({ length: w }, (_, px) => {
          const on = !!highlight && highlight.px === px && highlight.py === py;
          return (
            <g key={`${px}-${py}`}>
              <rect x={px + 0.04} y={py + 0.04} width={0.92} height={0.92} rx={0.08} fill={on ? RED : highlight ? '#ecebe7' : '#f3f2ee'} stroke={on ? RED : '#bdbbb5'} strokeWidth={0.03} />
              {showLabels && (
                <text x={px + 0.5} y={py + 0.52} fontSize={Math.min(0.4, 3.2 / cell + 0.12)} fontWeight="700" textAnchor="middle" dominantBaseline="central" fill={on ? '#fff' : '#55575f'}>
                  {panelLabel(px, py)}
                </text>
              )}
            </g>
          );
        }),
      )}
    </svg>
  );
}

/**
 * The whole mosaic as vector graphics: the base plate colour, one path of discs per colour, and
 * light panel lines every 16 studs. Vector output prints sharply at any resolution (and Chrome's
 * PDF output drops some raster images, so the cover doesn't depend on one).
 */
export function MosaicSvg({ data, label }: { data: MosaicData; label: string }) {
  const { result, colors, base } = data;
  const { width: W, height: H, cells } = result;
  const r = 0.44;
  const paths: string[][] = colors.map(() => []);
  for (let i = 0; i < cells.length; i++) {
    const x = i % W;
    const y = (i - x) / W;
    paths[cells[i]]?.push(`M${x + 0.5 - r} ${y + 0.5}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`);
  }
  const lines: string[] = [];
  for (let x = PANEL_STUDS; x < W; x += PANEL_STUDS) lines.push(`M${x} 0V${H}`);
  for (let y = PANEL_STUDS; y < H; y += PANEL_STUDS) lines.push(`M0 ${y}H${W}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label={label} style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill={rgbCss(base.rgb)} />
      {paths.map((d, k) => (d.length ? <path key={k} d={d.join('')} fill={rgbCss(colors[k])} /> : null))}
      {lines.length > 0 && <path d={lines.join('')} stroke="rgba(255,255,255,0.55)" strokeWidth={Math.max(0.08, W / 900)} fill="none" />}
    </svg>
  );
}

export function CoverSheet({ data, codes, info }: { data: MosaicData; codes: string[]; info: SheetInfo }) {
  const { t } = useTranslation();
  const { result, size, cm, bom, base, basePcs } = data;
  const aspect = result.width / result.height;
  const cols = bom.length > 24 ? 3 : 2;
  const rows = Math.ceil(bom.length / cols);
  // The picture gets the height the legend leaves (about 167 mm of the sheet is free for both).
  const imgH = Math.max(50, Math.min(150, 186 / aspect, 167 - rows * 5.8));
  const imgW = imgH * aspect;
  const byId = new Map(result.colorIds.map((id, i) => [id, i]));
  const basePart = t(`bases.part.${basePcs.part}`, { defaultValue: basePcs.part });

  return (
    <Sheet info={info} testId="print-cover">
      <h1 className="pb-title">{t('print.coverTitle')}</h1>
      <p className="pb-sub">{t('print.coverSub', { w: size.panelsW, h: size.panelsH, sw: result.width, sh: result.height, cw: fmtOne(cm.w), ch: fmtOne(cm.h) })}</p>

      <div style={{ margin: '5mm auto 5mm', width: `${imgW}mm`, height: `${imgH}mm`, flexShrink: 0 }}>
        <MosaicSvg data={data} label={t('print.imageAlt')} />
      </div>

      <div style={{ display: 'flex', gap: '8mm', alignItems: 'flex-start', marginBottom: '5mm' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pb-overline">{t('print.factsTitle')}</div>
          <table className="pb-facts">
            <tbody>
              <tr>
                <th>{t('print.factSize')}</th>
                <td>{t('print.factSizeValue', { cw: fmtOne(cm.w), ch: fmtOne(cm.h) })}</td>
              </tr>
              <tr>
                <th>{t('print.factStuds')}</th>
                <td>{t('print.factStudsValue', { w: result.width, h: result.height, n: fmtInt(data.studs) })}</td>
              </tr>
              <tr>
                <th>{t('print.factPanels')}</th>
                <td>{t('print.factPanelsValue', { count: size.panelsW * size.panelsH, w: size.panelsW, h: size.panelsH })}</td>
              </tr>
              <tr>
                <th>{t('print.factPieces')}</th>
                <td>{t('print.factPiecesValue', { total: fmtInt(data.pieces), spares: fmtInt(data.spares) })}</td>
              </tr>
              <tr>
                <th>{t('print.factColours')}</th>
                <td>{bom.length}</td>
              </tr>
              <tr>
                <th>{t('print.factBase')}</th>
                <td>{t('parts.baseValue', { count: basePcs.count, part: basePart, id: basePcs.part, colour: t(`bases.colour.${base.id}`) })}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ flexShrink: 0 }}>
          <div className="pb-overline">{t('print.mapTitle')}</div>
          <PanelMap w={size.panelsW} h={size.panelsH} maxW={70} maxH={42} />
        </div>
      </div>

      <div className="pb-overline">{t('print.legendTitle')}</div>
      <div className="pb-legend" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, auto)`, gridAutoFlow: 'column' }}>
        {bom.map((l) => {
          const i = byId.get(l.colorId) ?? 0;
          return (
            <div className="pb-legend-row" key={l.colorId}>
              <CodeDot rgb={data.colors[i]} code={codes[i]} size="5.4mm" />
              <span>{l.name}</span>
              <span className="num muted">{fmtInt(l.count)}</span>
              <span className="num" style={{ fontWeight: 700 }}>
                {fmtInt(l.total)}
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ color: '#6b6d74', fontSize: '7.5pt', marginTop: '2mm' }}>{t('print.legendNote')}</p>
    </Sheet>
  );
}

function StudGrid({ panel, colors, codes }: { panel: Panel; colors: Rgb[]; codes: string[] }) {
  const N = PANEL_STUDS;
  const L = 1; // label band, in studs
  const V = N + L;
  const guides = [4, 8, 12];
  return (
    <svg viewBox={`0 0 ${V} ${V}`} width="100%" style={{ display: 'block' }} role="img" aria-label={panel.label}>
      {Array.from({ length: N }, (_, x) => (
        <text key={`c${x}`} x={L + x + 0.5} y={0.55} fontSize={0.4} fontWeight="700" textAnchor="middle" dominantBaseline="central" fill="#55575f">
          {x + 1}
        </text>
      ))}
      {Array.from({ length: N }, (_, y) => (
        <text key={`r${y}`} x={0.45} y={L + y + 0.52} fontSize={0.4} fontWeight="700" textAnchor="middle" dominantBaseline="central" fill="#55575f">
          {String.fromCharCode(65 + y)}
        </text>
      ))}
      <rect x={L} y={L} width={N} height={N} fill="#f6f5f2" stroke="#bdbbb5" strokeWidth={0.03} />
      <g stroke="#cfcdc7" strokeWidth={0.025}>
        {guides.map((g) => (
          <line key={`v${g}`} x1={L + g} y1={L} x2={L + g} y2={L + N} />
        ))}
        {guides.map((g) => (
          <line key={`h${g}`} x1={L} y1={L + g} x2={L + N} y2={L + g} />
        ))}
      </g>
      {Array.from(panel.cells, (v, i) => {
        if (v === PANEL_EMPTY) return null;
        const x = L + (i % N) + 0.5;
        const y = L + Math.floor(i / N) + 0.5;
        const rgb = colors[v];
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={0.44} fill={rgbCss(rgb)} stroke="rgba(0,0,0,0.32)" strokeWidth={0.025} />
            <text x={x} y={y + 0.02} fontSize={0.35} fontWeight="700" textAnchor="middle" dominantBaseline="central" fill={textOn(rgb)}>
              {codes[v]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PanelSheet({ data, panel, names, codes, info }: { data: MosaicData; panel: Panel; names: string[]; codes: string[]; info: SheetInfo }) {
  const { t } = useTranslation();
  const entries = [...panel.counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const cols = entries.length > 24 ? 4 : 3;
  const rows = Math.ceil(entries.length / cols);
  return (
    <Sheet info={info} testId="print-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6mm', marginBottom: '3mm' }}>
        <div>
          <h2 className="pb-title" style={{ fontSize: '24pt' }}>
            {t('print.panelTitle', { label: panel.label })}
          </h2>
          <p className="pb-sub">{t('print.panelSub', { row: panelLabel(0, panel.py).replace(/\d+$/, ''), col: panel.px + 1, count: PANEL_STUDS * PANEL_STUDS })}</p>
        </div>
        <PanelMap w={data.size.panelsW} h={data.size.panelsH} maxW={48} maxH={20} highlight={{ px: panel.px, py: panel.py }} />
      </div>
      <StudGrid panel={panel} colors={data.colors} codes={codes} />
      <div className="pb-overline" style={{ marginTop: '3.5mm' }}>
        {t('print.panelLegend', { count: entries.length })}
      </div>
      <div className="pb-legend" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, auto)`, gridAutoFlow: 'column' }}>
        {entries.map(([k, n]) => (
          <div className="pb-legend-row" key={k} style={{ gridTemplateColumns: '6mm 1fr auto' }}>
            <CodeDot rgb={data.colors[k]} code={codes[k]} size="5mm" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names[k]}</span>
            <span className="num" style={{ fontWeight: 700 }}>
              {fmtInt(n)}
            </span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
