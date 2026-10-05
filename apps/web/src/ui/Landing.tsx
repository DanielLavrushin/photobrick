import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PaletteOutlined from '@mui/icons-material/PaletteOutlined';
import ListAlt from '@mui/icons-material/ListAlt';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EXAMPLES } from '../lib/examples.ts';
import { useApp } from '../state/store.ts';
import { Brand } from './Brand.tsx';
import { errorMessage } from './errors.ts';
import { Footer } from './Footer.tsx';

const HERO = `${import.meta.env.BASE_URL}examples/hero-mosaic.webp`;

function Promise_({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <Box
        sx={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'rgba(198, 58, 43, 0.1)',
          color: 'primary.dark',
        }}
        aria-hidden="true"
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, lineHeight: 1.3, mb: 0.25 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {body}
        </Typography>
      </Box>
    </Box>
  );
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

function isTouch(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function Hero({ small = false }: { small?: boolean }) {
  const { t } = useTranslation();
  return (
    <Box
      component="figure"
      sx={{
        m: 0,
        mx: 'auto',
        maxWidth: small ? 280 : 400,
        p: small ? 1.25 : 2,
        borderRadius: small ? 3 : 4,
        bgcolor: '#26282d',
        boxShadow: '0 24px 48px -16px rgba(28,29,34,0.45)',
      }}
    >
      <Box component="img" src={HERO} alt={t('landing.heroAlt')} width={600} height={720} sx={{ display: 'block', width: '100%', height: 'auto', borderRadius: 1.5, aspectRatio: '5 / 6' }} />
      <Typography component="figcaption" variant="caption" sx={{ display: 'block', color: 'rgba(255,255,255,0.75)', mt: small ? 0.75 : 1.25, textAlign: 'center' }}>
        {t('landing.heroCaption')}
      </Typography>
    </Box>
  );
}

export function Landing() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const openFile = useApp((s) => s.openFile);
  const openUrl = useApp((s) => s.openUrl);
  const error = useApp((s) => s.error);
  const clearError = useApp((s) => s.clearError);
  const retry = useApp((s) => s.retry);
  const [touch] = useState(isTouch);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void openFile(file, file.name);
  };

  const canRetry = error?.code === 'internal' || error?.code === 'example-fetch';

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Container component="main" maxWidth="lg" sx={{ flex: 1, py: { xs: 3, md: 5 } }}>
        <Box component="header" sx={{ mb: { xs: 3, md: 6 } }}>
          <Brand size="md" />
        </Box>

        <Box sx={{ display: 'grid', gap: { xs: 4, md: 6 }, gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' }, alignItems: 'center' }}>
          <Box>
            <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' }, lineHeight: 1.1, mb: 2 }}>
              {t('landing.title')}
            </Typography>
            <Typography variant="h6" component="p" color="text.secondary" sx={{ fontWeight: 400, mb: 4, maxWidth: 560, fontSize: { xs: '1.05rem', md: '1.2rem' } }}>
              {t('landing.pitch')}
            </Typography>

            {error && (
              <Alert
                severity={error.code === 'share-invalid' ? 'warning' : 'error'}
                onClose={clearError}
                sx={{ mb: 3, maxWidth: 560 }}
                action={
                  canRetry ? (
                    <Button color="inherit" size="small" onClick={retry}>
                      {t('common.retry')}
                    </Button>
                  ) : undefined
                }
              >
                {errorMessage(t, error)}
              </Alert>
            )}

            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, alignItems: { xs: 'stretch', sm: 'center' } }}>
              <Button variant="contained" size="large" startIcon={<AddPhotoAlternateOutlined />} onClick={() => inputRef.current?.click()}>
                {t('landing.choose')}
              </Button>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: { xs: 'center', sm: 'left' } }}>
                {touch ? t('landing.touchHint') : t('landing.dropHint', { shortcut: isMac() ? '⌘V' : 'Ctrl+V' })}
              </Typography>
            </Box>
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} aria-label={t('landing.choose')} data-testid="file-input" />

            <Box component="section" aria-labelledby="examples-title" sx={{ mt: { xs: 4, md: 5 } }}>
              <Typography id="examples-title" variant="overline" component="h2" color="text.secondary">
                {t('landing.examplesTitle')}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: { xs: 1.5, sm: 2 }, maxWidth: 560, mt: 1 }}>
                {EXAMPLES.map((ex) => (
                  <ButtonBase
                    key={ex.id}
                    onClick={() => void openUrl(ex.src, ex.fileName)}
                    data-example={ex.id}
                    sx={{
                      display: 'block',
                      textAlign: 'left',
                      borderRadius: 3,
                      overflow: 'hidden',
                      bgcolor: 'background.paper',
                      border: 1,
                      borderColor: 'divider',
                      transition: 'transform 120ms ease, box-shadow 120ms ease',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 8px 20px -8px rgba(28,29,34,0.35)' },
                    }}
                  >
                    <Box component="img" src={ex.thumb} alt="" loading="lazy" sx={{ display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
                    <Typography variant="body2" sx={{ px: 1.25, py: 1, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t(ex.titleKey)}
                    </Typography>
                  </ButtonBase>
                ))}
              </Box>
            </Box>
          </Box>

          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <Hero />
          </Box>
        </Box>

        <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 5 }}>
          <Hero small />
        </Box>

        <Box
          component="section"
          aria-label={t('landing.promisesLabel')}
          sx={{ mt: { xs: 5, md: 7 }, display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}
        >
          <Promise_ icon={<LockOutlined />} title={t('landing.promiseDevice')} body={t('landing.promiseDeviceBody')} />
          <Promise_ icon={<PaletteOutlined />} title={t('landing.promiseColours')} body={t('landing.promiseColoursBody')} />
          <Promise_ icon={<ListAlt />} title={t('landing.promiseParts')} body={t('landing.promisePartsBody')} />
        </Box>
      </Container>
      <Footer />
    </Box>
  );
}
