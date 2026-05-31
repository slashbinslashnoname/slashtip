import gpiox from "@iiot2k/gpiox";

const { init_gpio, pwm_gpio, stop_pwm_gpio, GPIO_MODE_OUTPUT } = gpiox;

// WhisPlay HAT RGB LED pins (BCM). Active-HIGH; PWM via software at 1 kHz.
const R_PIN = 25;
const G_PIN = 24;
const B_PIN = 23;
const PWM_FREQ_HZ = 1000;

export class RgbLed {
  constructor() {
    init_gpio(R_PIN, GPIO_MODE_OUTPUT, 0);
    init_gpio(G_PIN, GPIO_MODE_OUTPUT, 0);
    init_gpio(B_PIN, GPIO_MODE_OUTPUT, 0);
  }

  /** r/g/b in 0..255 → mapped to PWM duty %. */
  set(red: number, green: number, blue: number): void {
    setChannel(R_PIN, red);
    setChannel(G_PIN, green);
    setChannel(B_PIN, blue);
  }

  off(): void {
    this.set(0, 0, 0);
  }

  idle(): void {
    this.set(20, 20, 30);
  }
  selecting(): void {
    this.set(0, 30, 80);
  }
  waitingPayment(): void {
    this.set(200, 100, 0);
  }
  paid(): void {
    this.set(0, 180, 30);
  }
  expired(): void {
    this.set(180, 0, 0);
  }
}

function setChannel(pin: number, intensity: number): void {
  const v = Math.max(0, Math.min(255, Math.round(intensity)));
  const duty = Math.round((v / 255) * 100);
  if (duty === 0) {
    stop_pwm_gpio(pin);
    return;
  }
  pwm_gpio(pin, PWM_FREQ_HZ, duty);
}
