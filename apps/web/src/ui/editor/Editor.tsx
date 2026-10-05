import Construction from '@mui/icons-material/Construction';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import PaletteOutlined from '@mui/icons-material/PaletteOutlined';
import PhotoSizeSelectLarge from '@mui/icons-material/PhotoSizeSelectLarge';
import Tune from '@mui/icons-material/Tune';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../state/store.ts';
import { useUi } from '../../state/ui.ts';
import { Brand } from '../Brand.tsx';
import { Footer } from '../Footer.tsx';
import { BuildTab } from './BuildTab.tsx';
import { ColoursTab } from './ColoursTab.tsx';
import { LookTab } from './LookTab.tsx';
import { EditorError, Toasts } from './Notices.tsx';
import { PartsTab } from './PartsTab.tsx';
import { SizeTab } from './SizeTab.tsx';
import { ViewerPane, type EditorMode } from './ViewerPane.tsx';

const PrintView = lazy(() => import('../../print/PrintView.tsx'));

type TabId = 'size' | 'look' | 'colours' | 'parts' | 'build';

const TAB_ICONS: Record<TabId, ReactNode> = {
  size: <PhotoSizeSelectLarge />,
  look: <Tune />,
  colours: <PaletteOutlined />,
  parts: <Inventory2Outlined />,
  build: <Construction />,
};

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'size':
      return <SizeTab />;
    case 'look':
      return <LookTab />;
    case 'colours':
      return <ColoursTab />;
    case 'parts':
      return <PartsTab />;
    case 'build':
      return <BuildTab />;
  }
}

function PanelSkeleton() {
  return (
    <Box sx={{ p: 2 }} aria-hidden="true">
      <Skeleton width="40%" height={20} sx={{ mb: 1 }} />
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, mb: 3 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" height={96} />
        ))}
      </Box>
      <Skeleton width="30%" height={20} sx={{ mb: 1 }} />
      <Skeleton variant="rounded" height={40} sx={{ mb: 1 }} />
      <Skeleton variant="rounded" height={40} />
    </Box>
  );
}

function SharedBanner({ desktop }: { desktop: boolean }) {
  const { t } = useTranslation();
  const leaveShared = useApp((s) => s.leaveShared);
  return (
    <Box
      role="region"
      aria-label={t('shared.bannerLabel')}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, bgcolor: '#fff4d6', borderBottom: 1, borderColor: 'rgba(0,0,0,0.08)', flexShrink: 0 }}
      data-testid="shared-banner"
    >
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
        {t('shared.banner')}
        {desktop && (
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
            {' '}
            {t('shared.bannerSub')}
          </Box>
        )}
      </Typography>
      <Button variant="contained" size="small" onClick={leaveShared} sx={{ flexShrink: 0 }}>
        {t('shared.makeYourOwn')}
      </Button>
    </Box>
  );
}

export default function Editor({ mode }: { mode: EditorMode }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const tabs: TabId[] = mode === 'shared' ? ['parts', 'build'] : ['size', 'look', 'colours', 'parts', 'build'];
  const [chosen, setChosen] = useState<TabId>('size');
  const tab = tabs.includes(chosen) ? chosen : tabs[0];
  const setCropMode = useApp((s) => s.setCropMode);
  const photoName = useApp((s) => (s.phase === 'loading' ? s.loadingName : s.image?.name) ?? null);
  const printOpen = useUi((s) => s.printOpen);
  const setPrintOpen = useUi((s) => s.setPrintOpen);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Crop mode belongs to the Size tab.
  useEffect(() => {
    if (tab !== 'size') setCropMode(false);
  }, [tab, setCropMode]);

  const selectTab = (next: TabId) => {
    setChosen(next);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const panel =
    mode === 'loading' ? (
      <PanelSkeleton />
    ) : (
      <Box role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <TabContent tab={tab} />
      </Box>
    );

  const print = printOpen && (
    <Suspense fallback={null}>
      <PrintView onClose={() => setPrintOpen(false)} />
    </Suspense>
  );

  if (desktop) {
    return (
      <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
        <Box component="header" sx={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', px: 2, gap: 2, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <Brand size="sm" />
          {photoName && (
            <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0, pl: 2, borderLeft: 1, borderColor: 'divider' }} title={photoName}>
              {t('editor.photoName', { name: photoName })}
            </Typography>
          )}
        </Box>
        {mode === 'shared' && <SharedBanner desktop />}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
            <ViewerPane mode={mode} desktop />
          </Box>
          <Box component="aside" aria-label={t('editor.controls')} sx={{ width: 384, flexShrink: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider' }}>
            <Tabs value={tab} onChange={(_, v: TabId) => selectTab(v)} variant="fullWidth" aria-label={t('editor.tabs')} sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
              {tabs.map((id) => (
                <Tab key={id} value={id} id={`tab-${id}`} aria-controls={`panel-${id}`} label={t(`tabs.${id}`)} disabled={mode === 'loading'} data-testid={`tab-${id}`} sx={{ px: 0.5 }} />
              ))}
            </Tabs>
            <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ flex: 1 }}>{panel}</Box>
              <Footer dense />
            </Box>
          </Box>
        </Box>
        {print}
        <EditorError />
        <Toasts />
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      {mode === 'shared' && <SharedBanner desktop={false} />}
      <Box component="main" sx={{ height: mode === 'shared' ? '54dvh' : '57dvh', flexShrink: 0 }}>
        <ViewerPane mode={mode} desktop={false} />
      </Box>
      <Box ref={scrollRef} aria-label={t('editor.controls')} sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {panel}
        <Footer dense />
      </Box>
      <Paper square elevation={0} sx={{ flexShrink: 0, borderTop: 1, borderColor: 'divider', pb: 'env(safe-area-inset-bottom)' }}>
        <BottomNavigation value={tab} onChange={(_, v: TabId) => selectTab(v)} showLabels component="nav" aria-label={t('editor.tabs')} sx={{ height: 60 }}>
          {tabs.map((id) => (
            <BottomNavigationAction
              key={id}
              value={id}
              label={t(`tabs.${id}`)}
              icon={TAB_ICONS[id]}
              disabled={mode === 'loading'}
              data-testid={`tab-${id}`}
              sx={{ minWidth: 0, px: 0.5, '& .MuiBottomNavigationAction-label': { fontSize: 12, '&.Mui-selected': { fontSize: 12, fontWeight: 700 } } }}
            />
          ))}
        </BottomNavigation>
      </Paper>
      {print}
      <EditorError />
      <Toasts />
    </Box>
  );
}
