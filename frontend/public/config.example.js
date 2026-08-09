// Copia este archivo a config.js y completa los valores reales:
//   cp frontend/public/config.example.js frontend/public/config.js
//
// Estos valores viajan al navegador (no son secretos: la anon key de
// Supabase esta disenada para exponerse en clientes; el control de acceso
// real lo hace nuestra API validando el JWT con SUPABASE_JWT_SECRET, que
// ese si se queda solo en el backend).
window.APP_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'pegar-aqui-la-anon-key',
};
