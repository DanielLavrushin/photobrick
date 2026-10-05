import Print from '@mui/icons-material/Print';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { panelLabel } from '@photobrick/engine';
import { useTranslation } from 'react-i18next';
import { useUi } from '../../state/ui.ts';
import { useMosaicData } from '../useMosaicData.ts';
import { Section } from './parts.tsx';

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
      <Box
        aria-hidden="true"
        sx={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}
      >
        {n}
      </Box>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {body}
        </Typography>
      </Box>
    </Box>
  );
}

export function BuildTab() {
  const { t } = useTranslation();
  const data = useMosaicData();
  const setPrintOpen = useUi((s) => s.setPrintOpen);
  if (!data) return null;
  const panels = data.size.panelsW * data.size.panelsH;
  const last = panelLabel(data.size.panelsW - 1, data.size.panelsH - 1);
  const baseKey = data.base.studsPerPiece === 16 ? 'build.stepBase16' : 'build.stepBase48';

  return (
    <>
      <Section title={t('build.title')} first>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t('build.intro', { count: panels, w: data.size.panelsW, h: data.size.panelsH })}
        </Typography>
        <Button variant="contained" size="large" fullWidth startIcon={<Print />} onClick={() => setPrintOpen(true)} data-testid="print-open">
          {t('build.print')}
        </Button>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          {t('build.printHelp', { pages: panels + 1 })}
        </Typography>
      </Section>
      <Section title={t('build.howTitle')}>
        <Step n={1} title={t('build.stepPanelsTitle')} body={t('build.stepPanels', { last })} />
        <Step n={2} title={t('build.stepBaseTitle')} body={t(baseKey, { count: data.basePcs.count })} />
        <Step n={3} title={t('build.stepReadTitle')} body={t('build.stepRead')} />
        <Step n={4} title={t('build.stepJoinTitle')} body={t('build.stepJoin')} />
      </Section>
    </>
  );
}
