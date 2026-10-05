import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../state/store.ts';
import { useUi } from '../../state/ui.ts';
import { errorMessage } from '../errors.ts';

/** Above the phone's bottom navigation (60 px plus the safe area). */
const SNACK_SX = { bottom: { xs: 'calc(72px + env(safe-area-inset-bottom))', md: 24 } } as const;

/** Errors while editing (the landing page shows its own). */
export function EditorError() {
  const { t } = useTranslation();
  const phase = useApp((s) => s.phase);
  const error = useApp((s) => s.error);
  const clearError = useApp((s) => s.clearError);
  const retry = useApp((s) => s.retry);
  const open = !!error && phase !== 'landing';
  return (
    <Snackbar open={open} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={SNACK_SX}>
      <Alert
        severity="error"
        variant="filled"
        onClose={clearError}
        action={
          error?.code === 'internal' || error?.code === 'example-fetch' ? (
            <Button color="inherit" size="small" onClick={retry}>
              {t('common.retry')}
            </Button>
          ) : undefined
        }
      >
        {error ? errorMessage(t, error) : ''}
      </Alert>
    </Snackbar>
  );
}

export function Toasts() {
  const toast = useUi((s) => s.toast);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <Snackbar
      key={toast?.id}
      open={!!toast}
      autoHideDuration={toast?.severity === 'warning' ? 9000 : 4000}
      onClose={(_, reason) => {
        if (reason !== 'clickaway') dismiss();
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={SNACK_SX}
    >
      <Alert severity={toast?.severity ?? 'success'} variant="filled" onClose={dismiss} sx={{ maxWidth: 560 }} data-testid="toast">
        {toast?.message}
      </Alert>
    </Snackbar>
  );
}
