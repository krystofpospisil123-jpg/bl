// The player's mobile phone (Tab, or the Telefon button): a few contacts to call, each with a
// price. Calls run game actions (bring your car, tow truck, ambulance, lawyer) and the phone
// shows the answer for a moment.

export interface PhoneApp {
  name: string;
  /** Short line under the name (price, what it does). */
  info: () => string;
  /** Background colour of the round icon. */
  color: string;
  /** Letter on the icon. */
  letter: string;
  /** Runs the call; returns the answer shown on the phone. */
  call: () => string;
}

export class Phone {
  readonly el = document.createElement('div');
  private list = document.createElement('div');
  private clock = document.createElement('span');
  private answer = document.createElement('div');
  private answerUntil = 0;
  isOpen = false;

  constructor(private apps: PhoneApp[], private onToggle: (open: boolean) => void) {
    this.el.id = 'phone';
    this.el.hidden = true;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const net = document.createElement('span');
    net.textContent = 'Blansko·Net';
    bar.append(net, this.clock);
    this.list.className = 'apps';
    this.answer.className = 'answer';
    this.answer.hidden = true;
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Klávesy 1–4 · Tab zavřít';
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = 'Zavřít';
    close.addEventListener('click', () => this.toggle(false));
    this.el.append(bar, this.list, this.answer, hint, close);
    document.body.append(this.el);
    this.apps.forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'app';
      b.innerHTML = `<i style="background:${a.color}">${a.letter}</i><span><b>${i + 1}. ${a.name}</b><small></small></span>`;
      b.addEventListener('click', () => this.press(i));
      this.list.append(b);
    });
  }

  toggle(open = !this.isOpen) {
    if (open === this.isOpen) return;
    this.isOpen = open;
    this.el.hidden = !open;
    if (open) this.refresh();
    this.onToggle(open);
  }

  /** Calls contact `i` (0-based). */
  press(i: number) {
    const a = this.apps[i];
    if (!a || !this.isOpen) return;
    this.answer.textContent = a.call();
    this.answer.hidden = false;
    this.answerUntil = performance.now() + 5000;
    this.refresh();
  }

  update() {
    if (!this.isOpen) return;
    const d = new Date();
    const t = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (this.clock.textContent !== t) this.clock.textContent = t;
    if (!this.answer.hidden && performance.now() > this.answerUntil) this.answer.hidden = true;
  }

  private refresh() {
    this.apps.forEach((a, i) => {
      const small = this.list.children[i].querySelector('small')!;
      const text = a.info();
      if (small.textContent !== text) small.textContent = text;
    });
    this.update();
  }
}
