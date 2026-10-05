import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

/** Four round tiles on a dark plate: the app mark (also public/favicon.svg). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" style={{ display: 'block', flexShrink: 0 }}>
      <rect width="32" height="32" rx="8" fill="#26282d" />
      <circle cx="10.5" cy="10.5" r="5.8" fill="#c63a2b" />
      <circle cx="21.5" cy="10.5" r="5.8" fill="#f2b705" />
      <circle cx="10.5" cy="21.5" r="5.8" fill="#1f5fae" />
      <circle cx="21.5" cy="21.5" r="5.8" fill="#ece9e2" />
    </svg>
  );
}

export function Brand({ size = 'md', onDark = false }: { size?: 'sm' | 'md' | 'lg'; onDark?: boolean }) {
  const { t } = useTranslation();
  const px = size === 'lg' ? 44 : size === 'md' ? 30 : 24;
  const font = size === 'lg' ? '2rem' : size === 'md' ? '1.3rem' : '1.1rem';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: size === 'lg' ? 1.5 : 1 }}>
      <Logo size={px} />
      <Typography component="span" sx={{ fontWeight: 700, fontSize: font, letterSpacing: '-0.02em', color: onDark ? '#fff' : 'text.primary', lineHeight: 1 }}>
        {t('app.name')}
      </Typography>
    </Box>
  );
}
