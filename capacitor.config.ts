import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xavierguzman.inverclima',
  appName: 'InverClima',
  webDir: 'dist',
  // Se mantiene el esquema https por defecto para no perder los datos ya guardados en el teléfono.
  android: { backgroundColor: '#f4f7f3' },
  plugins: {
    // Las peticiones al ESP32 (http://IP-local) se hacen desde la capa nativa:
    // evita bloqueos de CORS y de "contenido mixto" dentro del APK.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
