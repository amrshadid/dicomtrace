/**
 * The frame bar under the image: a slider to scrub through frames (DICOM) or slices
 * (NIfTI), Play/Pause to watch them as a loop, and a second slider for volumes (4D
 * NIfTI). Shown only when there is more than one frame or volume. It drives the
 * renderer through callbacks and follows it through `update`, so the wheel, the arrow
 * keys and the slider always agree.
 */
import { h } from './dom';

/** Playback speed: frames per second. */
const FPS = 10;

export class FrameBar {
  readonly element = h('div', { class: 'frame-bar', role: 'group', aria: { label: 'Frames' } });
  private readonly play = h(
    'button',
    { class: 'frame-play', title: 'Play or pause (loops)' },
    'Play',
  );
  private readonly slider = h('input', { class: 'frame-slider' });
  private readonly label = h('span', { class: 'frame-label' });
  private readonly volumeSlider = h('input', { class: 'frame-slider volume-slider' });
  private readonly volumeLabel = h('span', { class: 'frame-label' });
  private frames = 1;
  private volumes = 1;
  private frame = 0;
  private volume = 0;
  private unit = 'frame';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onFrame: (index: number) => void,
    private readonly onVolume: (index: number) => void,
  ) {
    for (const s of [this.slider, this.volumeSlider]) {
      s.type = 'range';
      s.min = '1';
      s.step = '1';
    }
    this.volumeSlider.setAttribute('aria-label', 'Volume');
    this.element.append(this.play, this.slider, this.label, this.volumeSlider, this.volumeLabel);
    this.element.hidden = true;
    this.play.addEventListener('click', () => {
      if (this.timer) this.stop();
      else this.start();
    });
    this.slider.addEventListener('input', () => {
      this.onFrame(Number(this.slider.value) - 1);
    });
    this.volumeSlider.addEventListener('input', () => {
      this.onVolume(Number(this.volumeSlider.value) - 1);
    });
  }

  /** Sets up for a new image; hides itself when there is only one frame and volume. */
  configure(frames: number, volumes: number, unit: 'frame' | 'slice'): void {
    this.stop();
    this.frames = Math.max(1, frames);
    this.volumes = Math.max(1, volumes);
    this.unit = unit;
    this.slider.max = String(this.frames);
    this.slider.setAttribute('aria-label', unit === 'slice' ? 'Slice' : 'Frame');
    this.volumeSlider.max = String(this.volumes);
    this.volumeSlider.hidden = this.volumes < 2;
    this.volumeLabel.hidden = this.volumes < 2;
    this.slider.hidden = this.frames < 2;
    this.play.hidden = this.frames < 2;
    this.element.hidden = this.frames < 2 && this.volumes < 2;
    this.update(0, 0);
  }

  /** Follows the renderer: called whenever the shown frame or volume changes. */
  update(frame: number, volume = this.volume): void {
    this.frame = frame;
    this.volume = volume;
    this.slider.value = String(frame + 1);
    this.label.textContent = `${this.unit} ${frame + 1} / ${this.frames}`;
    this.volumeSlider.value = String(volume + 1);
    this.volumeLabel.textContent = `volume ${volume + 1} / ${this.volumes}`;
  }

  /** Hides the bar and stops playback (no image, or a different image). */
  hide(): void {
    this.stop();
    this.element.hidden = true;
  }

  private start(): void {
    if (this.frames < 2) return;
    this.play.textContent = 'Pause';
    this.play.setAttribute('aria-pressed', 'true');
    this.timer = setInterval(() => {
      this.onFrame((this.frame + 1) % this.frames);
    }, 1000 / FPS);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.play.textContent = 'Play';
    this.play.setAttribute('aria-pressed', 'false');
  }
}
