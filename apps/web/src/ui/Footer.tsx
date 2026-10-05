import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Trans, useTranslation } from 'react-i18next';
import { useUi } from '../state/ui.ts';

/** Legal footer shown on every screen: the LEGO Fair Play disclaimer and the Rebrickable credit. */
export function Footer({ dense = false }: { dense?: boolean }) {
  const { t } = useTranslation();
  const openDialog = useUi((s) => s.openDialog);
  return (
    <Box
      component="footer"
      sx={{
        px: 2,
        py: dense ? 2 : 3,
        borderTop: 1,
        borderColor: 'divider',
        color: 'text.secondary',
        textAlign: dense ? 'left' : 'center',
      }}
    >
      <Box sx={{ display: 'flex', gap: 2, justifyContent: dense ? 'flex-start' : 'center', mb: 1, flexWrap: 'wrap' }}>
        <Link component="button" type="button" variant="body2" onClick={() => openDialog('about')} underline="hover">
          {t('footer.about')}
        </Link>
        <Link component="button" type="button" variant="body2" onClick={() => openDialog('privacy')} underline="hover">
          {t('footer.privacy')}
        </Link>
      </Box>
      <Typography variant="caption" component="p" sx={{ display: 'block', lineHeight: 1.5 }}>
        {t('legal.disclaimer')}
      </Typography>
      <Typography variant="caption" component="p" sx={{ display: 'block', lineHeight: 1.5, mt: 0.5 }}>
        <Trans
          i18nKey="legal.rebrickable"
          components={{ anchor: <Link href="https://rebrickable.com" target="_blank" rel="noopener noreferrer" color="inherit" underline="always" /> }}
        />
      </Typography>
    </Box>
  );
}
