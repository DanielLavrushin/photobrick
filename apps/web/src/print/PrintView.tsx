// Full-screen printable instructions (lazy-loaded). Print or "Save as PDF" through window.print();
// print.css hides everything else and breaks one sheet per A4 page.

import './print.css';
import Close from '@mui/icons-material/Close';
import Print from '@mui/icons-material/Print';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { panelsOf } from '@photobrick/engine';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fileStem } from '../lib/download.ts';
import { colorById } from '../lib/palette.ts';
import { useApp } from '../state/store.ts';
import { useMosaicData } from '../ui/useMosaicData.ts';
import { CoverSheet, PanelSheet, type SheetInfo } from './sheets.tsx';

/** Width of an A4 sheet in CSS px plus the desk padding. */
const SHEET_PX = 794 + 24;

function screenZoom(): number {
  return typeof window === 'undefined' ? 1 : Math.min(1, window.innerWidth / SHEET_PX);
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export default function PrintView({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const data = useMosaicData();
  const imageName = useApp((s) => s.image?.name ?? null);
  const [zoom, setZoom] = useState(screenZoom);

  useEffect(() => {
    document.body.classList.add('pb-printing');
    const title = document.title;
    return () => {
      document.body.classList.remove('pb-printing');
      document.title = title;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setZoom(screenZoom());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const result = data?.result ?? null;
  const panels = useMemo(() => (result ? panelsOf(result) : []), [result]);
  const codes = useMemo(() => result?.colorIds.map((id) => colorById(id)?.code ?? '??') ?? [], [result]);
  const names = useMemo(() => result?.colorIds.map((id) => colorById(id)?.name ?? `#${id}`) ?? [], [result]);

  const name = imageName ?? t('print.sharedName');
  useEffect(() => {
    // Chrome suggests the document title as the PDF file name.
    document.title = `${fileStem(imageName, 'mosaic')}-photobrick-instructions`;
  }, [imageName]);

  if (!data) return null;
  const pages = panels.length + 1;
  const date = dateFmt.format(new Date());
  const info = (page: number): SheetInfo => ({ name, date, page, pages });

  return (
    <Dialog fullScreen open onClose={onClose} className="pb-print-dialog" aria-labelledby="print-title" slotProps={{ paper: { sx: { bgcolor: '#dcdad5' } } }}>
      <AppBar position="sticky" color="inherit" elevation={1} className="pb-print-toolbar">
        <Toolbar sx={{ gap: 1 }}>
          <IconButton edge="start" onClick={onClose} aria-label={t('common.close')}>
            <Close />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography id="print-title" variant="subtitle1" component="h2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {t('print.dialogTitle')}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="p">
              {t('print.dialogSub', { count: pages })}
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<Print />}
            onClick={() => window.print()}
            data-testid="print-now"
          >
            {t('print.print')}
          </Button>
        </Toolbar>
      </AppBar>
      <div className="pb-pages" style={{ ['--pb-zoom' as string]: String(zoom) }} data-ready="true" data-testid="print-pages">
        <CoverSheet data={data} codes={codes} info={info(1)} />
        {panels.map((p, i) => (
          <PanelSheet key={p.label} data={data} panel={p} names={names} codes={codes} info={info(i + 2)} />
        ))}
      </div>
    </Dialog>
  );
}
