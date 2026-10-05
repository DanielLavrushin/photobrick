import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { useTranslation } from 'react-i18next';
import { fmtEur, fmtInt } from '../../lib/format.ts';
import type { MosaicData } from '../useMosaicData.ts';

const chipSx = {
  height: { xs: 26, md: 28 },
  fontSize: { xs: 12, md: 13 },
  bgcolor: 'rgba(255,255,255,0.09)',
  color: '#fff',
  flexShrink: 0,
  '& .MuiChip-label': { px: { xs: 0.9, md: 1.25 } },
} as const;

/** '3 × 4 panels · 38 × 51 cm · 3,072 pieces · 18 colours · ≈ €100' as chips on the dark viewer bar. */
export function SummaryChips({ data }: { data: MosaicData }) {
  const { t } = useTranslation();
  return (
    <>
      <Chip size="small" sx={chipSx} label={t('summary.panels', { w: data.size.panelsW, h: data.size.panelsH })} />
      <Chip size="small" sx={chipSx} label={t('summary.cm', { w: fmtInt(data.cm.w), h: fmtInt(data.cm.h) })} />
      <Chip size="small" sx={chipSx} label={t('summary.pieces', { count: data.studs, n: fmtInt(data.studs) })} />
      <Chip size="small" sx={chipSx} label={t('summary.colours', { count: data.bom.length })} />
      <Tooltip title={t('summary.costHint')}>
        <Chip size="small" sx={{ ...chipSx, bgcolor: 'rgba(242,183,5,0.2)' }} label={t('summary.cost', { amount: fmtEur(data.cost.bricklinkEur) })} tabIndex={0} />
      </Tooltip>
    </>
  );
}
