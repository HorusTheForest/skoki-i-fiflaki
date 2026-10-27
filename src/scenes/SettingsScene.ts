import Phaser from 'phaser';
export class SettingsScene extends Phaser.Scene {
  constructor() {
    super('Settings');
  }
  create(): void {
    this.scene.start('Menu');
  }
}
