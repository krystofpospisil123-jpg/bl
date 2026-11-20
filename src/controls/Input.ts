// Keyboard state shared by all controllers.
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** True once per key press; call `endFrame()` after each frame. */
  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
  }
}

/** Mouse look shared by cameras: pointer lock on click, drag-to-look as fallback. */
export class MouseLook {
  dx = 0;
  dy = 0;
  lastMove = 0;
  private dragging = false;
  locked = false;

  constructor(dom: HTMLElement) {
    dom.addEventListener('click', () => {
      if (this.locked) return;
      try {
        const r = dom.requestPointerLock() as unknown as Promise<void> | undefined;
        r?.catch?.(() => {});
      } catch {
        /* pointer lock is optional */
      }
    });
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === dom));
    dom.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.locked && !this.dragging) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
      this.lastMove = performance.now();
    });
  }

  /** Returns and clears the accumulated mouse movement. */
  take(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return r;
  }
}
