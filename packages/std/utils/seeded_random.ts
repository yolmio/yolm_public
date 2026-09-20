export class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    // Create a numeric seed from the string
    this.seed = Array.from(seed).reduce(
      (acc, char) => char.charCodeAt(0) + ((acc << 5) - acc),
      0,
    );
  }

  // Returns a number between 0 and 1
  random(): number {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }
}
