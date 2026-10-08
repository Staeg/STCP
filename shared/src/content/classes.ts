export type ClassId = 'warden' | 'cutthroat' | 'lampbearer' | 'hexer';

export interface ClassDef {
  id: ClassId;
  name: string;
  role: string;
  color: string;
  maxHp: number;
  speed: number;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warden: { id: 'warden', name: 'Warden', role: 'Tank', color: '#5b8fd9', maxHp: 45, speed: 2 },
  cutthroat: { id: 'cutthroat', name: 'Cutthroat', role: 'Burst & locks', color: '#d94a4a', maxHp: 30, speed: 5 },
  lampbearer: { id: 'lampbearer', name: 'Lampbearer', role: 'Healer & light', color: '#e8c547', maxHp: 32, speed: 3 },
  hexer: { id: 'hexer', name: 'Hexer', role: 'Control & rituals', color: '#a66ad9', maxHp: 30, speed: 4 },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];
