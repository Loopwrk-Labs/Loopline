/// <reference types="vite/client" />
declare module 'exceljs/dist/exceljs.min.js';

declare module '*?url' {
  const src: string;
  export default src;
}
