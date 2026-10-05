import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useUi } from '../state/ui.ts';

function P({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body1" sx={{ mb: 1.5 }}>
      {children}
    </Typography>
  );
}

function H({ children }: { children: ReactNode }) {
  return (
    <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, mt: 2, mb: 0.5 }}>
      {children}
    </Typography>
  );
}

function RebrickableCredit() {
  return (
    <P>
      <Trans i18nKey="legal.rebrickable" components={{ anchor: <Link href="https://rebrickable.com" target="_blank" rel="noopener noreferrer" /> }} />
    </P>
  );
}

/** About, Privacy and the manual-copy fallback for share links. */
export default function InfoDialogs() {
  const { t } = useTranslation();
  const dialog = useUi((s) => s.dialog);
  const close = useUi((s) => s.closeDialog);
  const manualUrl = useUi((s) => s.manualShareUrl);
  const setManualUrl = useUi((s) => s.setManualShareUrl);

  return (
    <>
      <Dialog open={dialog === 'about'} onClose={close} maxWidth="sm" fullWidth scroll="paper" aria-labelledby="about-title">
        <DialogTitle id="about-title">{t('about.title')}</DialogTitle>
        <DialogContent dividers>
          <P>{t('about.what')}</P>
          <P>{t('about.how')}</P>
          <H>{t('about.privacyTitle')}</H>
          <P>{t('about.privacy')}</P>
          <H>{t('about.legalTitle')}</H>
          <P>{t('legal.disclaimer')}</P>
          <P>{t('about.fanProject')}</P>
          <RebrickableCredit />
          <P>{t('about.prices')}</P>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'privacy'} onClose={close} maxWidth="sm" fullWidth scroll="paper" aria-labelledby="privacy-title">
        <DialogTitle id="privacy-title">{t('privacy.title')}</DialogTitle>
        <DialogContent dividers>
          <P>{t('privacy.device')}</P>
          <P>{t('privacy.share')}</P>
          <P>{t('privacy.noTracking')}</P>
          <P>{t('privacy.storage')}</P>
          <P>{t('privacy.server')}</P>
          <H>{t('about.legalTitle')}</H>
          <P>{t('legal.disclaimer')}</P>
          <RebrickableCredit />
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={manualUrl !== null} onClose={() => setManualUrl(null)} maxWidth="sm" fullWidth aria-labelledby="share-manual-title">
        <DialogTitle id="share-manual-title">{t('share.manualTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('share.manualBody')}
          </Typography>
          <TextField
            value={manualUrl ?? ''}
            fullWidth
            multiline
            maxRows={6}
            label={t('share.linkLabel')}
            onFocus={(e) => e.target.select()}
            slotProps={{ htmlInput: { readOnly: true, spellCheck: false, style: { fontFamily: 'monospace', fontSize: 12 } } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualUrl(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
