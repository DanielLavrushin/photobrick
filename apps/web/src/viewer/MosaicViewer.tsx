import { useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type Ref } from 'react';
import { ViewerController, type MosaicViewerHandle, type MosaicViewerProps } from './controller.ts';

export interface MosaicViewerComponentProps extends MosaicViewerProps {
  ref?: Ref<MosaicViewerHandle>;
  className?: string;
  /** Merged over the defaults (fills the parent: width and height 100%). */
  style?: CSSProperties;
  'aria-label'?: string;
}

const HOST_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  // Pointer Events get every touch: no browser panning, zooming or selection on the mosaic.
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  WebkitTapHighlightColor: 'transparent',
};
const FILL: CSSProperties = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };
const OVERLAY_STYLE: CSSProperties = { ...FILL, display: 'block', pointerEvents: 'none' };

/**
 * The mosaic on one canvas (WebGL2, or Canvas2D as a fallback) with wheel / drag / pinch zoom and pan,
 * double-tap to fit, keyboard + - 0 and arrows when focused, a photo-compare overlay and a crop mode.
 * All pointer handling and drawing happens outside React; props only change what is drawn.
 */
export function MosaicViewer({ ref, className, style, 'aria-label': ariaLabel, ...props }: MosaicViewerComponentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<ViewerController | null>(null);

  // One controller (and so one WebGL context) per mount. StrictMode's second mount gets a fresh
  // canvas because the first one's context was released on unmount.
  useLayoutEffect(() => {
    const controller = new ViewerController(hostRef.current!, stageRef.current!, overlayRef.current!);
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  // Runs after every render, after the mount effect above; the controller diffs the props itself.
  useLayoutEffect(() => {
    controllerRef.current?.update(props);
  });

  useImperativeHandle(
    ref,
    () => ({
      fit: () => controllerRef.current?.fit(),
      getView: () => controllerRef.current?.getView() ?? { scale: 1, ox: 0, oy: 0 },
      zoomBy: (factor, cx, cy) => controllerRef.current?.zoomBy(factor, cx, cy),
      redraw: () => controllerRef.current?.redraw(),
      getRendererKind: () => controllerRef.current?.rendererKind() ?? null,
      getCanvas: () => controllerRef.current?.canvas() ?? null,
    }),
    [],
  );

  return (
    <div
      ref={hostRef}
      className={className}
      style={style ? { ...HOST_STYLE, ...style } : HOST_STYLE}
      tabIndex={0}
      role="img"
      aria-label={ariaLabel ?? 'Mosaic preview'}
    >
      <div ref={stageRef} style={FILL} />
      <canvas ref={overlayRef} style={OVERLAY_STYLE} width={1} height={1} aria-hidden="true" />
    </div>
  );
}
