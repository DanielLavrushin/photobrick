import Download from '@mui/icons-material/Download';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import Link from '@mui/icons-material/Link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableFooter from '@mui/material/TableFooter';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fileStem } from '../../lib/download.ts';
import { fmtEur, fmtInt, fmtIsoDate, fmtKr } from '../../lib/format.ts';
import { colorById, UNKNOWN_RGB } from '../../lib/palette.ts';
import { useApp } from '../../state/store.ts';
import { useUi } from '../../state/ui.ts';
import { exportPxPerStud } from '../../viewer/index.ts';
import { shareMosaic } from '../shareAction.ts';
import { useBaseId, useMosaicData, type MosaicData } from '../useMosaicData.ts';
import { Code, Section, Swatch } from './parts.tsx';

const PNG_PX_PER_STUD = 20;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
        {children}
      </Typography>
    </Box>
  );
}

function ExportButton({ icon, label, caption, onClick, busy, testId }: { icon: ReactNode; label: string; caption?: string; onClick: () => void; busy?: boolean; testId: string }) {
  return (
    <Box sx={{ mb: 1.25 }}>
      <Button
        variant="outlined"
        fullWidth
        startIcon={busy ? <CircularProgress size={18} /> : icon}
        onClick={onClick}
        disabled={busy}
        data-testid={testId}
        sx={{ justifyContent: 'flex-start', borderRadius: 2, py: 1 }}
      >
        {label}
      </Button>
      {caption && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, px: 0.5, lineHeight: 1.4 }}>
          {caption}
        </Typography>
      )}
    </Box>
  );
}

function BomTable({ data }: { data: MosaicData }) {
  const { t } = useTranslation();
  const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
  return (
    <Table size="small" aria-label={t('parts.tableLabel')} sx={{ '& td, & th': { px: 0.75 }, '& td:first-of-type, & th:first-of-type': { pl: 0 }, '& td:last-of-type, & th:last-of-type': { pr: 0 } }}>
      <TableHead>
        <TableRow>
          <TableCell>{t('parts.colColour')}</TableCell>
          <TableCell>{t('parts.colName')}</TableCell>
          <TableCell align="right">{t('parts.colCount')}</TableCell>
          <TableCell align="right">{t('parts.colSpares')}</TableCell>
          <TableCell align="right">{t('parts.colTotal')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {data.bom.map((l) => (
          <TableRow key={l.colorId} hover>
            <TableCell>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Swatch rgb={colorById(l.colorId)?.rgb ?? UNKNOWN_RGB} size={18} />
                <Code>{l.code}</Code>
              </Box>
            </TableCell>
            <TableCell sx={{ lineHeight: 1.3 }}>{l.name}</TableCell>
            <TableCell align="right" sx={num}>
              {fmtInt(l.count)}
            </TableCell>
            <TableCell align="right" sx={{ ...num, color: 'text.secondary' }}>
              +{fmtInt(l.spares)}
            </TableCell>
            <TableCell align="right" sx={{ ...num, fontWeight: 600 }}>
              {fmtInt(l.total)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow sx={{ '& td': { fontWeight: 700, color: 'text.primary', fontSize: '0.875rem', borderBottom: 0 } }}>
          <TableCell colSpan={2}>{t('parts.total')}</TableCell>
          <TableCell align="right" sx={num}>
            {fmtInt(data.studs)}
          </TableCell>
          <TableCell align="right" sx={num}>
            +{fmtInt(data.spares)}
          </TableCell>
          <TableCell align="right" sx={num}>
            {fmtInt(data.pieces)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

export function PartsTab() {
  const { t } = useTranslation();
  const data = useMosaicData();
  const imageName = useApp((s) => s.image?.name ?? null);
  const baseId = useBaseId();
  const notify = useUi((s) => s.notify);
  const [pabWarnings, setPabWarnings] = useState<string[] | null>(null);
  const [blSkipped, setBlSkipped] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return null;

  const stem = `${fileStem(imageName, 'mosaic')}-photobrick`;
  const px = exportPxPerStud(data.result.width, data.result.height, PNG_PX_PER_STUD);
  const notOnPab = data.cost.notOnPab.map((id) => colorById(id)?.name ?? `#${id}`);
  const basePart = t(`bases.part.${data.basePcs.part}`, { defaultValue: data.basePcs.part });

  const run = async (key: string, fn: (m: typeof import('../../exports/files.ts')) => void | Promise<void>) => {
    setBusy(key);
    try {
      const m = await import('../../exports/files.ts');
      await fn(m);
    } catch (err) {
      console.error('[photobrick] export failed', err);
      notify(t('parts.exportFailed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Section title={t('parts.listTitle', { count: data.bom.length })} first>
        <BomTable data={data} />
      </Section>

      <Section title={t('parts.totalsTitle')}>
        <Row label={t('parts.tiles')}>{t('parts.tilesValue', { studs: fmtInt(data.studs), spares: fmtInt(data.spares), total: fmtInt(data.pieces) })}</Row>
        <Row label={t('parts.colours')}>{fmtInt(data.bom.length)}</Row>
        <Row label={t('parts.base')}>
          {t('parts.baseValue', { count: data.basePcs.count, part: basePart, id: data.basePcs.part, colour: t(`bases.colour.${data.base.id}`) })}
        </Row>
        <Row label={t('parts.spares')}>{t('parts.sparesValue')}</Row>
      </Section>

      <Section title={t('parts.costTitle')}>
        <Row label={t('parts.bricklink')}>≈ {fmtEur(data.cost.bricklinkEur)}</Row>
        <Row label={t('parts.pab')}>
          {data.cost.pickABrickEur !== null && data.cost.pickABrickDkk !== null
            ? t('parts.pabValue', { eur: fmtEur(data.cost.pickABrickEur), dkk: fmtKr(data.cost.pickABrickDkk) })
            : t('parts.pabNone')}
        </Row>
        {notOnPab.length > 0 && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t('parts.notOnPab', { count: notOnPab.length, list: notOnPab.join(', ') })}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          {t('parts.pricesNote', { date: fmtIsoDate(data.cost.pricesAsOf) })}
        </Typography>
      </Section>

      <Section title={t('parts.exportsTitle')}>
        <ExportButton
          testId="export-bricklink"
          icon={<Download />}
          label={t('parts.exportBrickLink')}
          caption={t('parts.exportBrickLinkHelp')}
          busy={busy === 'bl'}
          onClick={() => void run('bl', (m) => setBlSkipped(m.saveBrickLink(data.bom, stem).map((l) => l.name)))}
        />
        {blSkipped && blSkipped.length > 0 && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {t('parts.blSkipped', { list: blSkipped.join(', ') })}
          </Alert>
        )}
        <ExportButton
          testId="export-pab"
          icon={<Download />}
          label={t('parts.exportPab')}
          caption={t('parts.exportPabHelp')}
          busy={busy === 'pab'}
          onClick={() => void run('pab', (m) => setPabWarnings(m.savePickABrick(data.bom, stem)))}
        />
        {pabWarnings && (
          <Alert severity={pabWarnings.length ? 'warning' : 'success'} sx={{ mb: 1.5 }} data-testid="pab-warnings">
            {pabWarnings.length ? (
              <>
                {t('parts.pabWarningsTitle')}
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                  {pabWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </Box>
              </>
            ) : (
              t('parts.pabNoWarnings')
            )}
          </Alert>
        )}
        <ExportButton
          testId="export-rebrickable"
          icon={<Download />}
          label={t('parts.exportRebrickable')}
          caption={t('parts.exportRebrickableHelp')}
          busy={busy === 'rb'}
          onClick={() => void run('rb', (m) => m.saveRebrickable(data.bom, stem))}
        />
        <ExportButton
          testId="export-png"
          icon={<ImageOutlined />}
          label={t('parts.exportPng')}
          caption={t('parts.exportPngHelp', { w: fmtInt(data.result.width * px), h: fmtInt(data.result.height * px) })}
          busy={busy === 'png'}
          onClick={() =>
            void run('png', async (m) => {
              await m.savePng(data.result, data.colors, data.base.rgb, stem, PNG_PX_PER_STUD);
            })
          }
        />
        <ExportButton
          testId="share-link"
          icon={<Link />}
          label={t('parts.shareLink')}
          caption={t('parts.shareLinkHelp')}
          busy={busy === 'share'}
          onClick={() => {
            setBusy('share');
            void shareMosaic(data.result, baseId, t).finally(() => setBusy(null));
          }}
        />
      </Section>
    </>
  );
}
