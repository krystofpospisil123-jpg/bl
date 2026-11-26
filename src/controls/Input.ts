// Keyboard state plus virtual keys and an analog stick (touch controls feed both).
export class Input {
  private keys = new Set<string>();
  private virtual = new Set<string>();
  private pressed = new Set<string>();
  /** Analog stick: x = right, y = forward, each -1..1 (0 when unused). */
  readonly stick = { x: 0, y: 0 };

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c) || this.virtual.has(c));
  }

  /** True once per key press; call `endFrame()` after each frame. */
  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Holds or releases a virtual key (on-screen buttons). */
  setVirtual(code: string, held: boolean) {
    if (held && !this.virtual.has(code)) this.pressed.add(code);
    if (held) this.virtual.add(code);
    else this.virtual.delete(code);
  }

  /** A single tap of a virtual key. */
  tap(code: string) {
    this.pressed.add(code);
  }

  endFrame() {
    this.pressed.clear();
  }
}

/**
 * Look input shared by cameras: pointer lock with a mouse, or dragging with a mouse or a
 * finger. Each drag is tracked by pointer id, so a second finger on the joystick or a
 * button does not disturb the view.
 */
export class MouseLook {
  dx = 0;
  dy = 0;
  lastMove = 0;
  locked = false;
  private drag: { id: number; x: number; y: number; touch: boolean } | null = null;

  constructor(dom: HTMLElement) {
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !this.locked) {
        try {
          const r = dom.requestPointerLock() as unknown as Promise<void> | undefined;
          r?.catch?.(() => {});
        } catch {
          /* pointer lock is optional */
        }
      }
      if (!this.drag) {
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
        try {
          dom.setPointerCapture?.(e.pointerId);
        } catch {
          /* optional */
        }
      }
    });
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === dom));
    const end = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('pointermove', (e) => {
      if (this.locked && e.pointerType === 'mouse') {
        this.dx += e.movementX;
        this.dy += e.movementY;
        this.lastMove = performance.now();
        return;
      }
      if (!this.drag || this.drag.id !== e.pointerId) return;
      // Fingers move less than a mouse for the same turn, so touch is a bit more sensitive.
      const k = this.drag.touch ? 1.6 : 1;
      this.dx += (e.clientX - this.drag.x) * k;
      this.dy += (e.clientY - this.drag.y) * k;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.lastMove = performance.now();
    });
  }

  /** Returns and clears the accumulated movement. */
  take(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return r;
  }
}
