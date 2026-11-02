import { Canvas, Point } from 'fabric';

const DEFAULT_MIN_ZOOM = 0.5;
const DEFAULT_MAX_ZOOM = 2.5;
const BUTTON_ZOOM_FACTOR = 1.2;
const WHEEL_ZOOM_SENSITIVITY = 0.94;

type FabricCanvas = Canvas;

interface NavigationOptions {
  minZoom?: number;
  maxZoom?: number;
  onZoomChange?: (zoom: number) => void;
  /**
   * Called with `true` when holding space starts a temporary hand tool, and with `false` when it ends:
   * space released, or the window blurred / tab hidden while space was held.
   */
  onSpaceHandChange?: (active: boolean) => void;
}

export interface FabricNavigationController {
  setHandMode(enabled: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  dispose(): void;
}

interface PointerPosition {
  x: number;
  y: number;
}

interface SelectionState {
  canvasSelection: boolean;
  objectSelectable: Array<{ object: { selectable: boolean }; selectable: boolean }>;
  isDrawingMode: boolean;
  defaultCursor: string;
  activeObject: ReturnType<FabricCanvas['getActiveObject']>;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.isContentEditable ||
    element.closest('.monaco-editor') !== null ||
    element.closest('input, textarea, [contenteditable="true"]') !== null
  );
}

function isTextEditing(canvas: FabricCanvas): boolean {
  const activeObject = canvas.getActiveObject();
  return Boolean(activeObject && (activeObject as { isEditing?: boolean }).isEditing);
}

function normalizeWheelDelta(event: WheelEvent, canvasElement: HTMLElement): PointerPosition {
  let multiplier = 1;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    multiplier = 16;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    multiplier = canvasElement.clientHeight || window.innerHeight;
  }

  return {
    x: event.deltaX * multiplier,
    y: event.deltaY * multiplier
  };
}

export function installFabricNavigation(
  canvas: FabricCanvas,
  options: NavigationOptions = {}
): FabricNavigationController {
  const canvasElement = canvas.upperCanvasEl;
  const minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
  const maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
  const onZoomChange = options.onZoomChange;
  const onSpaceHandChange = options.onSpaceHandChange;
  let spacePressed = false;
  let handMode = false;
  let panStart: PointerPosition | null = null;
  let selectionState: SelectionState | null = null;

  const restoreSelectionState = () => {
    if (!selectionState) return;
    const previousCursor = selectionState.defaultCursor;
    canvas.selection = selectionState.canvasSelection;
    canvas.isDrawingMode = selectionState.isDrawingMode;
    selectionState.objectSelectable.forEach(({ object, selectable }) => {
      object.selectable = selectable;
    });
    if (selectionState.activeObject && canvas.getObjects().includes(selectionState.activeObject)) {
      canvas.setActiveObject(selectionState.activeObject);
    }
    selectionState = null;
    canvas.defaultCursor = previousCursor;
    canvas.requestRenderAll();
  };

  const beginPan = (event: PointerEvent) => {
    const isMiddleButton = event.button === 1;
    const isSpacePan = event.button === 0 && (spacePressed || handMode);
    if (!isMiddleButton && !isSpacePan) return;
    if (isSpacePan && !handMode && (isEditableTarget(event.target) || isTextEditing(canvas)))
      return;

    event.preventDefault();
    event.stopPropagation();
    panStart = { x: event.clientX, y: event.clientY };
    selectionState = {
      canvasSelection: canvas.selection,
      isDrawingMode: canvas.isDrawingMode,
      objectSelectable: canvas.getObjects().map((object) => ({
        object,
        selectable: object.selectable
      })),
      defaultCursor: canvas.defaultCursor,
      activeObject: canvas.getActiveObject()
    };
    canvas.selection = false;
    canvas.isDrawingMode = false;
    canvas.getObjects().forEach((object) => {
      object.selectable = false;
    });
    canvas.discardActiveObject();
    canvas.defaultCursor = 'grabbing';
    canvasElement.setPointerCapture?.(event.pointerId);
  };

  const continuePan = (event: PointerEvent) => {
    if (!panStart) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = {
      x: event.clientX - panStart.x,
      y: event.clientY - panStart.y
    };
    panStart = { x: event.clientX, y: event.clientY };
    canvas.relativePan(new Point(delta.x, delta.y));
    canvas.requestRenderAll();
  };

  const endPan = (event?: PointerEvent) => {
    if (!panStart) return;
    event?.preventDefault();
    event?.stopPropagation();
    if (event && canvasElement.hasPointerCapture?.(event.pointerId)) {
      canvasElement.releasePointerCapture(event.pointerId);
    }
    panStart = null;
    restoreSelectionState();
  };

  const handleWheel = (event: WheelEvent) => {
    const delta = normalizeWheelDelta(event, canvasElement);
    // Chrome and Safari commonly report trackpad pinch as a Ctrl/Cmd wheel event;
    // browsers that do not expose that modifier cannot be distinguished reliably.
    const isZoomGesture = event.ctrlKey || event.metaKey;
    const pointer = canvas.getViewportPoint(event);

    if (isZoomGesture) {
      event.preventDefault();
      const zoom = Math.min(
        maxZoom,
        Math.max(minZoom, canvas.getZoom() * Math.pow(WHEEL_ZOOM_SENSITIVITY, delta.y))
      );
      canvas.zoomToPoint(pointer, zoom);
      onZoomChange?.(zoom);
      canvas.requestRenderAll();
      return;
    }

    let panX = delta.x;
    let panY = delta.y;
    if (event.shiftKey) {
      panX = delta.x || delta.y;
      panY = 0;
    }
    if (panX === 0 && panY === 0) return;

    event.preventDefault();
    canvas.relativePan(new Point(-panX, -panY));
    canvas.requestRenderAll();
  };

  /** Updates the space state, notifying only on a change (holding space repeats keydown). */
  const setSpacePressed = (pressed: boolean) => {
    if (spacePressed === pressed) return;
    spacePressed = pressed;
    onSpaceHandChange?.(pressed);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || isEditableTarget(event.target)) {
      return;
    }
    event.preventDefault();
    setSpacePressed(true);
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
      // finish the pan first so the tool switch happens after its state is restored
      if (panStart) endPan();
      setSpacePressed(false);
    }
  };

  const cancelPan = () => {
    endPan();
    setSpacePressed(false);
  };
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    cancelPan();
  };
  const zoomBy = (factor: number) => {
    const zoom = Math.min(maxZoom, Math.max(minZoom, canvas.getZoom() * factor));
    canvas.zoomToPoint(canvas.getCenterPoint(), zoom);
    onZoomChange?.(zoom);
    canvas.requestRenderAll();
  };

  canvasElement.addEventListener('pointerdown', beginPan, true);
  canvasElement.addEventListener('pointermove', continuePan, true);
  canvasElement.addEventListener('pointerup', endPan, true);
  canvasElement.addEventListener('pointercancel', endPan, true);
  canvasElement.addEventListener('wheel', handleWheel, { passive: false });
  canvasElement.addEventListener('contextmenu', handleContextMenu);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', cancelPan);
  window.addEventListener('pointerup', endPan);
  document.addEventListener('visibilitychange', cancelPan);

  return {
    setHandMode(enabled: boolean) {
      handMode = enabled;
      if (!enabled && panStart) cancelPan();
    },
    zoomIn() {
      zoomBy(BUTTON_ZOOM_FACTOR);
    },
    zoomOut() {
      zoomBy(1 / BUTTON_ZOOM_FACTOR);
    },
    dispose() {
      cancelPan();
      canvasElement.removeEventListener('pointerdown', beginPan, true);
      canvasElement.removeEventListener('pointermove', continuePan, true);
      canvasElement.removeEventListener('pointerup', endPan, true);
      canvasElement.removeEventListener('pointercancel', endPan, true);
      canvasElement.removeEventListener('wheel', handleWheel);
      canvasElement.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', cancelPan);
      window.removeEventListener('pointerup', endPan);
      document.removeEventListener('visibilitychange', cancelPan);
    }
  };
}
