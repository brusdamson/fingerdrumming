import './style.css';
import { app } from './app';
import { calibrationScreen } from './ui/calibration';
import { freeplayScreen } from './ui/freeplay';
import { homeScreen } from './ui/home';
import { settingsScreen } from './ui/settings';
import { sliceEditorScreen } from './ui/sliceEditor';

app.mount(
  document.getElementById('app')!,
  [
    { id: 'home', label: 'Уроки', open: homeScreen },
    { id: 'free', label: 'Свободная игра', open: freeplayScreen },
    { id: 'slicer', label: 'Мой брейк', open: sliceEditorScreen },
    { id: 'calibration', label: 'Калибровка', open: calibrationScreen },
    { id: 'settings', label: 'Настройки', open: settingsScreen },
  ],
  () => app.open('home'),
);
