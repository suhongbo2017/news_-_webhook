import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 用相对路径：同一份产物可挂在任意子路径（GitHub Pages / 对象存储）。
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
