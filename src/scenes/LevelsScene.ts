import Phaser from 'phaser';
export class LevelsScene extends Phaser.Scene {
  constructor() {
    super('Levels');
  }
  create(): void {
    this.scene.start('Menu');
  }
}
