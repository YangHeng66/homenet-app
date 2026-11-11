import { mount } from 'svelte';
import './app.css';
import App from './ui/App.svelte';
import { applySettings } from './lib/store.svelte';
import { applyFontScale } from './lib/native';

applySettings();
applyFontScale();

mount(App, { target: document.getElementById('app')! });
